const router = require("express").Router()
const pool = require("../db")
const auth = require("../middleware/auth")
const paystack = require("../lib/paystack")

function normalizePhone(phone) {
  if (!phone) return ""
  return phone.replace(/[^0-9]/g, "")
}

const managerOnly = (req, res) => {
  if (req.user.role !== "manager") {
    res.status(403).json({ error: "Managers only" })
    return false
  }
  return true
}

router.post("/initialize", auth, async (req, res) => {
  if (req.user.role !== "buyer") {
    return res.status(403).json({ error: "Only buyers can initiate payments" })
  }

  const { order_id, method, phone } = req.body
  if (!order_id) {
    return res.status(400).json({ error: "order_id is required" })
  }
  if (!["card", "mpesa", "bank"].includes(method)) {
    return res.status(400).json({ error: "method must be 'card', 'mpesa' or 'bank'" })
  }

  try {
    const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [order_id])
    const order = orderResult.rows[0]
    if (!order) {
      return res.status(404).json({ error: "Order not found" })
    }
    if (order.buyer_id !== req.user.id) {
      return res.status(403).json({ error: "This order does not belong to you" })
    }

    const userResult = await pool.query("SELECT email, phone FROM users WHERE id = $1", [req.user.id])
    const buyer = userResult.rows[0]
    if (!buyer?.email) {
      return res.status(400).json({ error: "Your account has no email for payment" })
    }

    const reference = paystack.generateReference("PAY")
    const channels = method === "mpesa" ? ["mobile_money"] : (method === "bank" ? ["bank"] : ["card"])
    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL

    const mobileMoney =
      method === "mpesa"
        ? { phone: normalizePhone(phone || buyer.phone), provider: "mpesa" }
        : undefined

    const paymentResult = await pool.query(
      `INSERT INTO payments (order_id, buyer_id, amount, status, method, paystack_reference, currency)
       VALUES ($1, $2, $3, 'Pending', $4, $5, 'KES')
       RETURNING *`,
      [order_id, req.user.id, Number(order.total_amount), method, reference]
    )

    const data = await paystack.initializeTransaction({
      email: buyer.email,
      amountKes: Number(order.total_amount),
      reference,
      channels,
      callbackUrl,
      metadata: { order_id: String(order_id), buyer_id: req.user.id },
      mobileMoney
    })

    if (method === "mpesa" && !data.authorization_url) {
      res.status(201).json({
        reference,
        method,
        authorization_url: null,
        message: "Check your phone to approve the M-Pesa prompt."
      })
      return
    }

    res.status(201).json({
      reference,
      method,
      authorization_url: data.authorization_url,
      access_code: data.access_code
    })
  } catch (error) {
    res.status(502).json({ error: error.message })
  }
})

router.post("/verify", auth, async (req, res) => {
  const { reference } = req.body
  if (!reference) {
    return res.status(400).json({ error: "reference is required" })
  }

  try {
    const localResult = await pool.query("SELECT * FROM payments WHERE paystack_reference = $1", [reference])
    const local = localResult.rows[0]
    if (!local) {
      return res.status(404).json({ error: "Payment not found" })
    }
    if (req.user.role === "buyer" && local.buyer_id !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" })
    }

    let status = local.status
    let verified = false
    try {
      const data = await paystack.verifyTransaction(reference)
      verified = data.status === "success"
    } catch (_error) {
      verified = local.status === "Verified"
    }

    if (verified && status !== "Verified") {
      const updated = await pool.query(
        "UPDATE payments SET status = 'Verified' WHERE id = $1 RETURNING *",
        [local.id]
      )
      await pool.query("UPDATE orders SET status = 'Paid' WHERE id = $1", [local.order_id])
      status = updated.rows[0].status
    }

    res.json({ reference, status, verified })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/", auth, async (req, res) => {
  try {
    const values = []
    let where = ""

    if (req.user.role === "buyer") {
      values.push(req.user.id)
      where = "WHERE p.buyer_id = $1"
    } else if (req.user.role === "farmer") {
      values.push(req.user.id)
      where = "WHERE o.farmer_id = $1"
    }

    const result = await pool.query(
      `
      SELECT
        p.id,
        p.order_id,
        p.buyer_id,
        o.farmer_id,
        buyer.name AS buyer,
        farmer.name AS farmer,
        o.quantity,
        o.total_amount,
        p.amount,
        p.status,
        p.created_at
      FROM payments p
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN users buyer ON p.buyer_id = buyer.id
      LEFT JOIN users farmer ON o.farmer_id = farmer.id
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

router.post("/", auth, async (req, res) => {
  const { order_id, buyer_id, amount } = req.body
  if (!order_id) {
    return res.status(400).json({ error: "order_id is required" })
  }

  try {
    const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [order_id])
    const order = orderResult.rows[0]
    if (!order) {
      return res.status(404).json({ error: "Order not found" })
    }

    const buyerId = req.user.role === "buyer" ? req.user.id : (buyer_id || order.buyer_id)
    const paymentAmount = Number(amount || order.total_amount)

    const paymentResult = await pool.query(
      "INSERT INTO payments (order_id, buyer_id, amount, status) VALUES ($1, $2, $3, 'Verified') RETURNING *",
      [order_id, buyerId, paymentAmount]
    )

    await pool.query("UPDATE orders SET status = 'Paid' WHERE id = $1", [order_id])

    res.status(201).json(paymentResult.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/:id/status", auth, async (req, res) => {
  if (!managerOnly(req, res)) return

  const allowedStatuses = new Set(["Pending", "Verified", "Held", "Rejected"])
  const { status } = req.body

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid payment status" })
  }

  try {
    const result = await pool.query(
      `UPDATE payments
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Payment not found" })
    }

    if (status === "Verified") {
      await pool.query("UPDATE orders SET status = 'Paid' WHERE id = $1", [result.rows[0].order_id])
    }

    res.json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
