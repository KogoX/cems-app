const router = require("express").Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT y.id, u.name as farmer, y.crop_season, y.variety, y.quantity, y.grade, y.status, y.created_at as date
      FROM yields y
      LEFT JOIN users u ON y.farmer_id = u.id
      ORDER BY y.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const { farmer_id, cropSeason, quantity, grade, date } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO yields (farmer_id, crop_season, quantity, grade, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [farmer_id, cropSeason, quantity, grade, date ? new Date(date) : new Date()]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
