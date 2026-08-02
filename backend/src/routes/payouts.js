const router = require("express").Router()
const pool = require("../db")
const auth = require("../middleware/auth")
const paystack = require("../lib/paystack")

const MPESA_BANK_CODE = "MPESA"
const AIRTEL_BANK_CODE = "AIRTEL"

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
  if (!["mpesa", "bank", "cash", "airtel"].includes(method)) {
    return res.status(400).json({ error: "method must be 'mpesa', 'bank', 'cash', or 'airtel'" })
  }

  try {
    // Duplicate Payout Lock: return existing record if identical payout was created in the last 15 seconds
    const duplicateCheck = await pool.query(
      `SELECT * FROM payouts 
       WHERE farmer_id = $1 AND amount = $2 AND created_at > NOW() - INTERVAL '15 seconds'`,
      [farmer_id, Number(amount)]
    )
    if (duplicateCheck.rows.length > 0) {
      return res.status(200).json(duplicateCheck.rows[0])
    }

    const farmerResult = await pool.query("SELECT * FROM users WHERE id = $1 AND role = 'farmer'", [farmer_id])
    const farmer = farmerResult.rows[0]
    if (!farmer) {
      return res.status(404).json({ error: "Farmer not found" })
    }

    const reference = paystack.generateReference("PO")
    let status = method === "cash" ? "Paid" : "Processing"
    let transferCode = null
    let finalNotes = notes || null

    if (method !== "cash") {
      const isMobileMoney = method === "mpesa" || method === "airtel"
      const recipientAccount = isMobileMoney ? normalizePhone(phone || farmer.phone) : account_number
      const recipientBankCode = method === "mpesa" ? MPESA_BANK_CODE : (method === "airtel" ? AIRTEL_BANK_CODE : bank_code)

      if (!recipientAccount) {
        return res.status(400).json({ error: `A ${isMobileMoney ? "phone number" : "bank account number"} is required for ${method} payouts` })
      }

      try {
        const recipient = await paystack.createTransferRecipient({
          name: farmer.name,
          type: isMobileMoney ? "mobile_money" : "nuban",
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
        finalNotes = finalNotes ? `${finalNotes} | Paystack: ${transfer.transfer_code || ""}` : `Paystack: ${transfer.transfer_code || ""}`
        status = "Paid"
      } catch (paystackErr) {
        console.warn("Paystack transfer note:", paystackErr.message)
        finalNotes = finalNotes ? `${finalNotes} | Ref: ${reference}` : `Ref: ${reference}`
      }
    }

    const result = await pool.query(
      `INSERT INTO payouts (farmer_id, order_id, amount, method, status, reference, paystack_transfer_code, notes, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [farmer_id, order_id || null, Number(amount), method, status, reference, transferCode, finalNotes]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/unpaid-stock", auth, async (req, res) => {
  if (req.user.role !== "manager" && req.user.role !== "farmer") {
    return res.status(403).json({ error: "Unauthorized" })
  }

  const { getMarketRate } = require("../lib/marketRates")

  try {
    const whereConditions = []
    const values = []

    if (req.user.role === "farmer") {
      values.push(req.user.id)
      whereConditions.push(`COALESCE(o.farmer_id, y.farmer_id) = $${values.length}`)
    }

    const farmerWhere = whereConditions.length > 0 ? `AND ${whereConditions.join(" AND ")}` : ""

    const query = `
      SELECT
        o.id AS order_id,
        o.yield_id,
        COALESCE(o.farmer_id, y.farmer_id) AS farmer_id,
        f.name AS farmer_name,
        f.phone AS farmer_phone,
        o.produce,
        COALESCE(y.grade, 'A') AS grade,
        o.quantity,
        o.unit_price AS buyer_unit_price,
        o.total_amount AS buyer_total_amount,
        o.status AS order_status,
        o.created_at AS order_date
      FROM orders o
      LEFT JOIN yields y ON o.yield_id = y.id
      JOIN users f ON f.id = COALESCE(o.farmer_id, y.farmer_id)
      LEFT JOIN (
        SELECT order_id, status FROM payments WHERE status = 'Verified'
      ) p ON p.order_id = o.id
      WHERE (o.status IN ('Paid', 'Scheduled', 'Fulfilled') OR p.status = 'Verified')
        ${farmerWhere}
        AND o.id NOT IN (
          SELECT order_id FROM payouts WHERE order_id IS NOT NULL AND status IN ('Paid', 'Processing', 'Pending')
        )
      ORDER BY o.created_at DESC
    `

    const result = await pool.query(query, values)

    const items = result.rows.map((row) => {
      const rateInfo = getMarketRate(row.grade)
      const qty = Number(row.quantity || 0)
      const buyerPrice = Number(row.buyer_unit_price || rateInfo.buyerPrice)
      const buyerTotal = Number(row.buyer_total_amount || (qty * buyerPrice))
      const farmerRate = rateInfo.farmerPayoutRate
      const farmerPayoutAmount = qty * farmerRate
      const coopRate = rateInfo.coldChainMargin
      const coopRetainedAmount = qty * coopRate

      return {
        order_id: row.order_id,
        stock_unique_id: `STOCK-${String(row.order_id).padStart(4, "0")}`,
        yield_id: row.yield_id,
        farmer_id: row.farmer_id,
        farmer_name: row.farmer_name,
        farmer_phone: row.farmer_phone,
        produce: row.produce,
        grade: row.grade,
        quantity: qty,
        buyer_unit_price: buyerPrice,
        buyer_total_amount: buyerTotal,
        farmer_payout_rate: farmerRate,
        farmer_payout_amount: farmerPayoutAmount,
        coop_margin_rate: coopRate,
        coop_retained_amount: coopRetainedAmount,
        order_status: row.order_status,
        order_date: row.order_date,
      }
    })

    res.json(items)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/", auth, async (req, res) => {
  try {
    const whereConditions = []
    const values = []

    if (req.user.role === "farmer") {
      values.push(req.user.id)
      whereConditions.push(`p.farmer_id = $${values.length}`)
    }

    if (req.query.startDate) {
      values.push(req.query.startDate)
      whereConditions.push(`p.created_at >= $${values.length}`)
    }

    if (req.query.endDate) {
      const end = req.query.endDate.includes("T") ? req.query.endDate : `${req.query.endDate}T23:59:59.999Z`
      values.push(end)
      whereConditions.push(`p.created_at <= $${values.length}`)
    }

    const where = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    const limit = parseInt(req.query.limit) || 50
    const offset = parseInt(req.query.offset) || 0
    values.push(limit, offset)
    const limitIdx = values.length - 1
    const offsetIdx = values.length

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
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
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

router.post("/batch", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Managers only" })
  }

  const { payouts, notes } = req.body
  if (!payouts || !Array.isArray(payouts) || payouts.length === 0) {
    return res.status(400).json({ error: "payouts array is required and must not be empty" })
  }

  try {
    const results = []
    const recipientCreationPromises = []

    // 1. Validate all items and look up farmers
    for (const item of payouts) {
      const { farmer_id, amount, method } = item
      if (!farmer_id || !amount || !method) {
        return res.status(400).json({ error: "farmer_id, amount and method are required for all payouts" })
      }
      if (!["mpesa", "bank", "cash", "airtel"].includes(method)) {
        return res.status(400).json({ error: "method must be 'mpesa', 'bank', 'cash', or 'airtel'" })
      }
    }

    // 2. Fetch all farmers involved
    const farmerIds = [...new Set(payouts.map(p => p.farmer_id))]
    const farmersResult = await pool.query("SELECT * FROM users WHERE id = ANY($1) AND role = 'farmer'", [farmerIds])
    const farmersMap = new Map(farmersResult.rows.map(f => [f.id, f]))

    for (const item of payouts) {
      const farmer = farmersMap.get(item.farmer_id)
      if (!farmer) {
        return res.status(404).json({ error: `Farmer with ID ${item.farmer_id} not found` })
      }
      item.farmerName = farmer.name
      item.farmerPhone = farmer.phone
    }

    // 3. Create recipients and initiate Paystack transfers
    const paystackItems = payouts.filter(p => p.method !== "cash")
    if (paystackItems.length > 0) {
      try {
        for (const item of paystackItems) {
          const isMobileMoney = item.method === "mpesa" || item.method === "airtel"
          const recipientAccount = isMobileMoney ? normalizePhone(item.phone || item.farmerPhone) : item.account_number
          const recipientBankCode = item.method === "mpesa" ? MPESA_BANK_CODE : (item.method === "airtel" ? AIRTEL_BANK_CODE : item.bank_code)

          if (recipientAccount) {
            try {
              const recipient = await paystack.createTransferRecipient({
                name: item.farmerName,
                type: isMobileMoney ? "mobile_money" : "nuban",
                accountNumber: recipientAccount,
                bankCode: recipientBankCode,
                currency: "KES",
                metadata: { farmer_id: item.farmer_id }
              })
              item.recipientCode = recipient.recipient_code
            } catch (err) {
              console.warn(`Paystack recipient creation note for ${item.farmerName}:`, err.message)
            }
          }
        }

        const transfers = paystackItems.filter(p => p.recipientCode).map(p => {
          p.reference = paystack.generateReference("PO")
          return {
            amountKes: Number(p.amount),
            recipientCode: p.recipientCode,
            reference: p.reference
          }
        })

        if (transfers.length > 0) {
          try {
            const bulkData = await paystack.initiateBulkTransfer({ transfers })
            if (bulkData && Array.isArray(bulkData)) {
              for (let i = 0; i < paystackItems.length; i++) {
                paystackItems[i].transferCode = bulkData[i]?.transfer_code || paystackItems[i].recipientCode
              }
            }
          } catch (err) {
            console.warn("Paystack bulk transfer note:", err.message)
          }
        }
      } catch (err) {
        console.warn("Paystack batch error:", err.message)
      }
    }

    // 4. Insert payout records into the DB
    for (const item of payouts) {
      const reference = item.reference || paystack.generateReference("PO")
      const status = item.method === "cash" ? "Paid" : "Processing"
      const transferCode = item.transferCode || null
      const finalNotes = notes ? `${notes} | Ref: ${reference}` : `Ref: ${reference}`

      const result = await pool.query(
        `INSERT INTO payouts (farmer_id, order_id, amount, method, status, reference, paystack_transfer_code, notes, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING *`,
        [item.farmer_id, item.order_id || null, Number(item.amount), item.method, status, reference, transferCode, finalNotes]
      )
      results.push(result.rows[0])
    }

    res.status(201).json(results)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
