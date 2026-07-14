const crypto = require("crypto")

const PAYSTACK_BASE = "https://api.paystack.co"
const SECRET = process.env.PAYSTACK_SECRET_KEY

function authHeaders() {
  if (!SECRET) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured on the server")
  }
  return {
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json"
  }
}

async function paystackFetch(path, options = {}) {
  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch (_error) {
    json = { raw: text }
  }
  if (!response.ok || json.status === false) {
    const message = json.message || `Paystack request failed (${response.status})`
    const error = new Error(message)
    error.paystack = json
    error.statusCode = response.status
    throw error
  }
  return json
}

function toKobo(amountKes) {
  return Math.round(Number(amountKes) * 100)
}

function generateReference(prefix) {
  const random = crypto.randomBytes(8).toString("hex")
  return `${prefix}_${Date.now()}_${random}`
}

async function initializeTransaction({ email, amountKes, reference, channels, callbackUrl, metadata, mobileMoney }) {
  const body = {
    email,
    amount: toKobo(amountKes),
    reference,
    channels,
    metadata: metadata || {},
    callback_url: callbackUrl
  }
  if (mobileMoney) {
    body.mobile_money = mobileMoney
  }
  const result = await paystackFetch("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(body)
  })
  return result.data
}

async function verifyTransaction(reference) {
  const result = await paystackFetch(`/transaction/verify/${reference}`)
  return result.data
}

async function createTransferRecipient({ name, type, accountNumber, bankCode, currency = "KES", metadata }) {
  const body = {
    type,
    name,
    account_number: accountNumber,
    currency,
    metadata: metadata || {}
  }
  if (type === "nuban") {
    body.bank_code = bankCode
  }
  const result = await paystackFetch("/transferrecipient", {
    method: "POST",
    body: JSON.stringify(body)
  })
  return result.data
}

async function initiateTransfer({ amountKes, recipientCode, reason, reference }) {
  const body = {
    source: "balance",
    amount: toKobo(amountKes),
    recipient: recipientCode,
    reason: reason || "CEMS farmer payout",
    reference
  }
  const result = await paystackFetch("/transfer", {
    method: "POST",
    body: JSON.stringify(body)
  })
  return result.data
}

async function initiateBulkTransfer({ transfers }) {
  const body = {
    source: "balance",
    currency: "KES",
    transfers: transfers.map(t => ({
      amount: toKobo(t.amountKes),
      recipient: t.recipientCode,
      reference: t.reference
    }))
  }
  const result = await paystackFetch("/transfer/bulk", {
    method: "POST",
    body: JSON.stringify(body)
  })
  return result.data
}

function verifyWebhookSignature(rawBody, signature) {
  if (!SECRET || !signature) return false
  const hash = crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex")
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature))
}

module.exports = {
  PAYSTACK_BASE,
  initializeTransaction,
  verifyTransaction,
  createTransferRecipient,
  initiateTransfer,
  initiateBulkTransfer,
  verifyWebhookSignature,
  generateReference,
  toKobo
}
