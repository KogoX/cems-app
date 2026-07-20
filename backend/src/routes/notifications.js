const express = require("express")
const pool = require("../db")
const auth = require("../middleware/auth")

const router = express.Router()

router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    )
    res.json(result.rows)
  } catch (error) {
    console.error("Error fetching notifications:", error)
    res.status(500).json({ error: "Failed to fetch notifications" })
  }
})

router.put("/read", auth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
      [req.user.id]
    )
    res.json({ message: "Notifications marked as read" })
  } catch (error) {
    console.error("Error updating notifications:", error)
    res.status(500).json({ error: "Failed to mark notifications as read" })
  }
})

module.exports = router
