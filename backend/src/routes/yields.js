const router = require("express").Router()
const pool = require("../db")
const auth = require("../middleware/auth")

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
        y.created_at
      FROM yields y
      LEFT JOIN users u ON y.farmer_id = u.id
      ${where}
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
  const { cropSeason, variety, quantity, grade, date, farmer_id } = req.body

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
    res.status(201).json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
