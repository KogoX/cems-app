const router = require("express").Router()
const pool = require("../db")
const auth = require("../middleware/auth")

router.get("/", auth, async (req, res) => {
  try {
    const values = []
    let where = ""

    if (req.user.role === "buyer") {
      values.push(req.user.id)
      where = "WHERE o.buyer_id = $1"
    }

    const result = await pool.query(
      `
      SELECT
        o.id,
        o.buyer_id,
        u.name AS buyer,
        o.produce,
        o.quantity,
        o.unit_price,
        o.total_amount,
        o.status,
        o.created_at,
        p.status AS payment_status
      FROM orders o
      LEFT JOIN users u ON o.buyer_id = u.id
      LEFT JOIN LATERAL (
        SELECT status
        FROM payments p2
        WHERE p2.order_id = o.id
        ORDER BY p2.created_at DESC
        LIMIT 1
      ) p ON true
      ${where}
      ORDER BY o.created_at DESC
      `,
      values
    )
    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.post("/", auth, async (req, res) => {
  const { buyer_id, produce, quantity, unitPrice } = req.body
  if (!quantity) {
    return res.status(400).json({ error: "quantity is required" })
  }

  const buyerId = req.user.role === "buyer" ? req.user.id : buyer_id
  if (!buyerId) {
    return res.status(400).json({ error: "buyer_id is required" })
  }

  const qty = Number(quantity)
  const price = Number(unitPrice || 1200)
  const total = qty * price

  try {
    const result = await pool.query(
      `INSERT INTO orders (buyer_id, produce, quantity, unit_price, total_amount)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [buyerId, produce || "Avocado (Hass)", qty, price, total]
    )
    res.status(201).json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
