const router = require("express").Router()
const pool = require("../db")
const auth = require("../middleware/auth")
const paystack = require("../lib/paystack")

const MPESA_BANK_CODE = "000013"

function normalizePhone(phone) {
  if (!phone) return ""
  return phone.replace(/[^0-9]/g, "")
}

router.post("/", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Managers only" })
  }

  const { farmer_id, order_id, amount, method, phone, bank_code, account_number, notes } = req.body
  if (!farmer_id || !amount || !method) {
    return res.status(400).json({ error: "farmer_id, amount and method are required" })
  }
  if (!["mpesa", "bank", "cash"].includes(method)) {
    return res.status(400).json({ error: "method must be 'mpesa', 'bank' or 'cash'" })
  }

  try {
    const farmerResult = await pool.query("SELECT * FROM users WHERE id = $1 AND role = 'farmer'", [farmer_id])
    const farmer = farmerResult.rows[0]
    if (!farmer) {
      return res.status(404).json({ error: "Farmer not found" })
    }

    const reference = paystack.generateReference("PO")
    let status = "Processing"
    let transferCode = null
    let finalNotes = notes || null

    if (method === "cash") {
      status = "Paid"
    } else {
      const isMpesa = method === "mpesa"
      const recipientAccount = isMpesa ? normalizePhone(phone || farmer.phone) : account_number
      const recipientBankCode = isMpesa ? MPESA_BANK_CODE : bank_code

      if (!recipientAccount) {
        return res.status(400).json({ error: `A ${isMpesa ? "phone number" : "bank account number"} is required for ${method} payouts` })
      }

      const recipient = await paystack.createTransferRecipient({
        name: farmer.name,
        type: isMpesa ? "mobile_money" : "nuban",
        accountNumber: recipientAccount,
        bankCode: recipientBankCode,
        currency: "KES",
        metadata: { farmer_id }
      })
      transferCode = recipient.recipient_code

      const transfer = await paystack.initiateTransfer({
        amountKes: Number(amount),
        recipientCode: recipient.recipient_code,
        reason: `CEMS payout to ${farmer.name}`,
        reference
      })
      transferCode = transfer.transfer_code || recipient.recipient_code
      finalNotes = finalNotes ? `${finalNotes} | ${transfer.transfer_code || ""}` : transfer.transfer_code || null
    }

    const result = await pool.query(
      `INSERT INTO payouts (farmer_id, order_id, amount, method, status, reference, paystack_transfer_code, notes, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${method === "cash" ? "NOW()" : "NULL"})
       RETURNING *`,
      [farmer_id, order_id || null, Number(amount), method, status, reference, transferCode, finalNotes]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    res.status(502).json({ error: error.message })
  }
})

router.get("/", auth, async (req, res) => {
  try {
    const values = []
    let where = ""
    if (req.user.role === "farmer") {
      values.push(req.user.id)
      where = "WHERE p.farmer_id = $1"
    }

    const result = await pool.query(
      `
      SELECT
        p.id,
        p.farmer_id,
        f.name AS farmer,
        p.order_id,
        p.amount,
        p.method,
        p.status,
        p.reference,
        p.notes,
        p.created_at,
        p.processed_at
      FROM payouts p
      LEFT JOIN users f ON p.farmer_id = f.id
      ${where}
      ORDER BY p.created_at DESC
      `,
      values
    )
    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/:id/status", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Managers only" })
  }

  const allowedStatuses = new Set(["Pending", "Processing", "Paid", "Failed"])
  const { status } = req.body
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid payout status" })
  }

  try {
    const result = await pool.query(
      `UPDATE payouts
       SET status = $1,
           processed_at = CASE WHEN $1 = 'Paid' THEN NOW() ELSE processed_at END
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    )
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Payout not found" })
    }
    res.json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
