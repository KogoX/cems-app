const router = require("express").Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.order_id, u.name as buyer, o.quantity, p.amount, p.status, p.created_at as date 
      FROM payments p
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN users u ON p.buyer_id = u.id
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const { order_id, buyer_id, amount } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO payments (order_id, buyer_id, amount) VALUES ($1, $2, $3) RETURNING *",
      [order_id, buyer_id, amount]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
