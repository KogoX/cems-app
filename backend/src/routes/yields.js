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

    if (req.user.role === "farmer") {
      values.push(req.user.id)
      where = "WHERE y.farmer_id = $1"
    }

    const result = await pool.query(
      `
      SELECT
        y.id,
        y.farmer_id,
        u.name AS farmer,
        y.crop_season,
        y.variety,
        y.quantity,
        y.grade,
        y.status,
        y.created_at,
        COALESCE(
          json_agg(yp.image_data ORDER BY yp.created_at) FILTER (WHERE yp.id IS NOT NULL),
          '[]'
        ) AS photos
      FROM yields y
      LEFT JOIN users u ON y.farmer_id = u.id
      LEFT JOIN yield_photos yp ON yp.yield_id = y.id
      ${where}
      GROUP BY y.id, u.name
      ORDER BY y.created_at DESC
      `,
      values
    )

    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.post("/", auth, async (req, res) => {
  const { cropSeason, variety, quantity, grade, date, farmer_id, photos } = req.body

  if (!cropSeason || !quantity || !grade) {
    return res.status(400).json({ error: "cropSeason, quantity and grade are required" })
  }

  const farmerId = req.user.role === "farmer" ? req.user.id : farmer_id
  if (!farmerId) {
    return res.status(400).json({ error: "farmer_id is required" })
  }

  try {
    const result = await pool.query(
      `INSERT INTO yields (farmer_id, crop_season, variety, quantity, grade, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        farmerId,
        cropSeason,
        variety || "Avocado (Hass)",
        Number(quantity),
        grade,
        date ? new Date(date) : new Date()
      ]
    )
    const yieldRecord = result.rows[0]
    const safePhotos = Array.isArray(photos) ? photos.slice(0, 5).filter(Boolean) : []

    for (const imageData of safePhotos) {
      await pool.query(
        "INSERT INTO yield_photos (yield_id, image_data) VALUES ($1, $2)",
        [yieldRecord.id, imageData]
      )
    }

    // Notify all managers
    await pool.query(`
      INSERT INTO notifications (user_id, title, message)
      SELECT id, 'New Harvest Uploaded', 'A farmer has uploaded a new harvest that requires review.'
      FROM users WHERE role = 'manager'
    `)

    res.status(201).json({ ...yieldRecord, photos: safePhotos })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/:id/status", auth, async (req, res) => {
  if (!managerOnly(req, res)) return

  const allowedStatuses = new Set(["Logged", "Approved", "Scheduled", "Exported", "Rejected"])
  const { status } = req.body

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid yield status" })
  }

  try {
    const result = await pool.query(
      `UPDATE yields
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Yield not found" })
    }

    const updatedYield = result.rows[0]

    if (status === "Approved") {
      // Notify the farmer
      await pool.query(
        "INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)",
        [updatedYield.farmer_id, "Harvest Approved", "Your harvest has been approved and is now listed on the marketplace."]
      )

      // Notify all buyers
      await pool.query(`
        INSERT INTO notifications (user_id, title, message)
        SELECT id, 'New Harvest Available', 'A new verified harvest has been added to the marketplace.'
        FROM users WHERE role = 'buyer'
      `)
    }

    res.json(updatedYield)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
