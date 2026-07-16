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
      where = "WHERE o.buyer_id = $1"
    } else if (req.user.role === "farmer") {
      values.push(req.user.id)
      where = "WHERE o.farmer_id = $1"
    }

    const result = await pool.query(
      `
      SELECT
        o.id,
        o.buyer_id,
        o.farmer_id,
        o.yield_id,
        buyer.name AS buyer,
        farmer.name AS farmer,
        o.produce,
        o.quantity,
        o.unit_price,
        o.total_amount,
        o.status,
        o.created_at,
        p.status AS payment_status
      FROM orders o
      LEFT JOIN users buyer ON o.buyer_id = buyer.id
      LEFT JOIN users farmer ON o.farmer_id = farmer.id
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
    const newOrder = result.rows[0]

    // Notify all managers
    await pool.query(`
      INSERT INTO notifications (user_id, title, message)
      SELECT id, 'New Buyer Order', 'A buyer has placed a new order of ' || $1 || ' kg.'
      FROM users WHERE role = 'manager'
    `, [qty])

    res.status(201).json(newOrder)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/:id/status", auth, async (req, res) => {
  if (!managerOnly(req, res)) return

  const allowedStatuses = new Set(["Processing", "Approved", "Scheduled", "Paid", "Fulfilled", "Cancelled"])
  const { status } = req.body

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid order status" })
  }

  try {
    if (status === "Scheduled") {
      const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id])
      const order = orderResult.rows[0]

      if (!order) {
        return res.status(404).json({ error: "Order not found" })
      }

      const matchResult = await pool.query(
        `SELECT id, farmer_id
         FROM yields
         WHERE status IN ('Approved', 'Scheduled')
           AND LOWER(variety) = LOWER($1)
           AND quantity >= $2
         ORDER BY
           CASE WHEN status = 'Approved' THEN 0 ELSE 1 END,
           created_at ASC
         LIMIT 1`,
        [order.produce, order.quantity]
      )
      const match = matchResult.rows[0]

      if (!match) {
        return res.status(409).json({ error: "No approved farmer harvest can satisfy this order yet" })
      }

      const result = await pool.query(
        `UPDATE orders
         SET status = 'Scheduled',
             farmer_id = $1,
             yield_id = $2
         WHERE id = $3
         RETURNING *`,
        [match.farmer_id, match.id, req.params.id]
      )

      await pool.query("UPDATE yields SET status = 'Scheduled' WHERE id = $1", [match.id])

      // Notify the farmer that their harvest is matched
      await pool.query(
        "INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)",
        [match.farmer_id, "Harvest Matched", "Your harvest has been matched with a buyer order and scheduled for export."]
      )

      return res.json(result.rows[0])
    }

    const result = await pool.query(
      `UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Order not found" })
    }

    res.json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
