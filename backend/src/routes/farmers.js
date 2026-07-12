const router = require("express").Router()
const pool = require("../db")

router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.location,
        u.status,
        u.created_at,
        COALESCE(SUM(y.quantity), 0) AS total_yield_kg
      FROM users u
      LEFT JOIN yields y ON y.farmer_id = u.id
      WHERE u.role = 'farmer'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `)
    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
