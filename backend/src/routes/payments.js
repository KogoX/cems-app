const router = require("express").Router()
const pool = require("../db")
const auth = require("../middleware/auth")

const managerOnly = (req, res) => {
  if (req.user.role !== "manager") {
    res.status(403).json({ error: "Managers only" })
    return false
  }
  return true
}

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
