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
    const whereConditions = []
    const values = []

    if (req.user.role === "buyer") {
      values.push(req.user.id)
      whereConditions.push(`o.buyer_id = $${values.length}`)
    } else if (req.user.role === "farmer") {
      values.push(req.user.id)
      whereConditions.push(`o.farmer_id = $${values.length}`)
    }

    if (req.query.startDate) {
      values.push(req.query.startDate)
      whereConditions.push(`o.created_at >= $${values.length}`)
    }

    if (req.query.endDate) {
      const end = req.query.endDate.includes("T") ? req.query.endDate : `${req.query.endDate}T23:59:59.999Z`
      values.push(end)
      whereConditions.push(`o.created_at <= $${values.length}`)
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
        o.id,
        o.buyer_id,
        o.farmer_id,
        o.yield_id,
        buyer.name AS buyer,
        farmer.name AS farmer,
        o.produce,
        y.grade,
        o.quantity,
        o.unit_price,
        o.total_amount,
        o.status,
        o.tracking_location,
        o.estimated_delivery,
        o.created_at,
        p.status AS payment_status,
        COALESCE(
          (
            SELECT json_agg(image_data)
            FROM (
              SELECT image_data
              FROM yield_photos
              WHERE yield_id = o.yield_id
              ORDER BY created_at ASC
            ) photos
          ),
          '[]'::json
        ) AS photos
      FROM orders o
      LEFT JOIN users buyer ON o.buyer_id = buyer.id
      LEFT JOIN users farmer ON o.farmer_id = farmer.id
      LEFT JOIN yields y ON o.yield_id = y.id
      LEFT JOIN LATERAL (
        SELECT status
        FROM payments p2
        WHERE p2.order_id = o.id
        ORDER BY p2.created_at DESC
        LIMIT 1
      ) p ON true
      ${where}
      ORDER BY o.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      values
    )
    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.post("/", auth, async (req, res) => {
  const { buyer_id, produce, quantity, unitPrice, yield_id } = req.body
  if (!quantity) {
    return res.status(400).json({ error: "quantity is required" })
  }

  const buyerId = req.user.role === "buyer" ? req.user.id : buyer_id
  if (!buyerId) {
    return res.status(400).json({ error: "buyer_id is required" })
  }

  const { getMarketRate } = require("../lib/marketRates")
  const qty = Number(quantity)
  let price = Number(unitPrice)
  if (!price || isNaN(price)) {
    price = getMarketRate("A").buyerPrice
  }
  const total = qty * price

  try {
    let farmerId = null
    let orderStatus = "Processing"
    
    // If buyer provides yield_id, lock it immediately
    if (yield_id) {
      const yieldCheck = await pool.query("SELECT id, farmer_id, status FROM yields WHERE id = $1 FOR UPDATE", [yield_id])
      if (yieldCheck.rows.length > 0 && yieldCheck.rows[0].status === "Approved") {
        farmerId = yieldCheck.rows[0].farmer_id
        orderStatus = "Scheduled"
        await pool.query("UPDATE yields SET status = 'Scheduled' WHERE id = $1", [yield_id])
      }
    }

    const result = await pool.query(
      `INSERT INTO orders (buyer_id, produce, quantity, unit_price, total_amount, yield_id, farmer_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [buyerId, produce || "Avocado (Hass)", qty, price, total, yield_id || null, farmerId, orderStatus]
    )
    const newOrder = result.rows[0]

    // Notify all managers
    await pool.query(`
      INSERT INTO notifications (user_id, title, message, target_url)
      SELECT id, 'New Buyer Order', 'A buyer has placed a new order of ' || $1 || ' kg.', $2
      FROM users WHERE role = 'manager'
    `, [qty, `/manager?order=${newOrder.id}`])

    res.status(201).json(newOrder)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/:id/status", auth, async (req, res) => {
  if (!managerOnly(req, res)) return

  const allowedStatuses = new Set(["Processing", "Approved", "Scheduled", "Paid", "Picked Up", "In Transit", "Ready for Pickup", "Fulfilled", "Cancelled"])
  const { status, trackingLocation, estimatedDelivery } = req.body

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
        "INSERT INTO notifications (user_id, title, message, target_url) VALUES ($1, $2, $3, $4)",
        [match.farmer_id, "Harvest Matched", "Your harvest has been matched with a buyer order and scheduled for export.", `/farmer?yield=${match.id}`]
      )

      return res.json(result.rows[0])
    }

    const loc = trackingLocation !== undefined ? trackingLocation : tracking_location
    const est = estimatedDelivery !== undefined ? estimatedDelivery : estimated_delivery

    let updateQuery = `
      UPDATE orders
      SET status = $1
    `
    const updateParams = [status, req.params.id]
    let paramIndex = 3

    if (loc !== undefined) {
      updateQuery += `, tracking_location = $${paramIndex}`
      updateParams.push(loc)
      paramIndex++
    }
    if (est !== undefined) {
      updateQuery += `, estimated_delivery = $${paramIndex}`
      updateParams.push(est ? new Date(est) : null)
      paramIndex++
    }

    updateQuery += ` WHERE id = $2 RETURNING *`

    const result = await pool.query(updateQuery, updateParams)

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Order not found" })
    }

    const updatedOrder = result.rows[0]

    // If tracking was updated, notify the buyer
    if (status === "In Transit" || status === "Ready for Pickup" || status === "Picked Up" || loc) {
      let msg = `Your shipment status is now: ${status}.`
      if (loc) {
        msg += ` Location: ${loc}.`
      }
      
      await pool.query(
        "INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)",
        [updatedOrder.buyer_id, "Shipment Tracking Update", msg]
      ).catch(() => {})
    }

    res.json(updatedOrder)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
