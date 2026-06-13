const router = require("express").Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, u.name as buyer, o.quantity, o.status, o.created_at as date 
      FROM orders o 
      LEFT JOIN users u ON o.buyer_id = u.id 
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const { buyer_id, produce, quantity } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO orders (buyer_id, produce, quantity) VALUES ($1, $2, $3) RETURNING *",
      [buyer_id, produce || 'Avocado (Hass)', quantity]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
