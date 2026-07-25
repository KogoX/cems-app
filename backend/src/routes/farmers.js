const router = require("express").Router()
const pool = require("../db")
const auth = require("../middleware/auth")

router.get("/", auth, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.phone,
        u.location,
        u.status,
        u.manager_id,
        manager.name AS manager_name,
        u.created_at,
        COALESCE(SUM(y.quantity), 0) AS total_yield_kg
      FROM users u
      LEFT JOIN users manager ON manager.id = u.manager_id
      LEFT JOIN yields y ON y.farmer_id = u.id
      WHERE u.role = 'farmer'
      GROUP BY u.id, manager.name
      ORDER BY u.created_at DESC
    `)
    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
