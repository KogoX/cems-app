const router = require("express").Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, location, status, created_at as added FROM users WHERE role = 'farmer' ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  // Usually handled by auth/register, but kept for legacy
  const { name, location } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO users (name, location, role) VALUES ($1, $2, 'farmer') RETURNING *",
      [name, location]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
