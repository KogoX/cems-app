const router = require("express").Router()
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")

const pool = require("../db")
const auth = require("../middleware/auth")

const allowedRoles = new Set(["farmer", "manager", "buyer"])

async function getUniqueId(pool) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  while (true) {
    let generated = ""
    for (let i = 0; i < 5; i++) {
      generated += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    const check = await pool.query("SELECT id FROM users WHERE unique_id = $1", [generated])
    if (check.rows.length === 0) {
      return generated
    }
  }
}

router.post("/register", async (req, res) => {
  const { name, email, phone, password, role, location } = req.body

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: "name, email, password and role are required" })
  }
  if (!allowedRoles.has(role)) {
    return res.status(400).json({ error: "Invalid role" })
  }

  try {
    const hash = await bcrypt.hash(password, 10)
    const uniqueId = await getUniqueId(pool)
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, location, unique_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, email, phone, role, location, unique_id`,
      [name, email.toLowerCase().trim(), phone || null, hash, role, location || null, uniqueId]
    )

    const user = result.rows[0]
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "2d" })
    res.status(201).json({ token, user })
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already exists" })
    }
    res.status(500).json({ error: error.message })
  }
})

router.post("/login", async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" })
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()])
    const user = result.rows[0]
    if (!user) {
      return res.status(401).json({ error: "Invalid login details" })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: "Invalid login details" })
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "2d" })
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        location: user.location,
        unique_id: user.unique_id
      }
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/me", auth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, email, phone, role, location, status, created_at, unique_id, national_id, verified, payment_details FROM users WHERE id = $1",
    [req.user.id]
  )
  if (!result.rows[0]) {
    return res.status(404).json({ error: "User not found" })
  }
  res.json(result.rows[0])
})

router.patch("/me", auth, async (req, res) => {
  const { name, phone, location, payment_details } = req.body
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Name is required" })
  }
  try {
    const result = await pool.query(
      `UPDATE users
       SET name = $1, phone = $2, location = $3, payment_details = $4
       WHERE id = $5
       RETURNING id, name, email, phone, role, location, status, created_at, unique_id, national_id, verified, payment_details`,
      [name.trim(), phone?.trim() || null, location?.trim() || null, payment_details?.trim() || null, req.user.id]
    )
    res.json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/me/verify", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Only managers can verify their identity here" })
  }
  const { national_id } = req.body
  if (!national_id || !national_id.trim()) {
    return res.status(400).json({ error: "National ID is required" })
  }
  try {
    const result = await pool.query(
      `UPDATE users
       SET national_id = $1, verified = TRUE
       WHERE id = $2
       RETURNING id, name, email, phone, role, location, status, created_at, unique_id, national_id, verified`,
      [national_id.trim().toUpperCase(), req.user.id]
    )
    res.json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/managers/verified", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, unique_id, verified
       FROM users
       WHERE role = 'manager' AND verified = TRUE
       ORDER BY name ASC`
    )
    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/users", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Managers only" })
  }

  try {
    const result = await pool.query(`
      SELECT
        id, name, email, phone, role, location, status, created_at, unique_id, national_id, verified, payment_details
      FROM users
      ORDER BY created_at DESC
    `)

    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})


router.patch("/users/:id/status", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Managers only" })
  }

  const allowedStatuses = new Set(["Active", "Pending", "Suspended"])
  const { status } = req.body

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid user status" })
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET status = $1
       WHERE id = $2
       RETURNING id, name, email, phone, role, location, status, created_at, unique_id`,
      [status, req.params.id]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: "User not found" })
    }

    res.json(result.rows[0])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.delete("/me", auth, async (req, res) => {
  try {
    // Unassign any orders where this user was the farmer so buyers don't lose order data
    await pool.query("UPDATE orders SET farmer_id = NULL WHERE farmer_id = $1", [req.user.id])
    
    // Delete the user record. Cascading handles yields, payouts, payments, notifications.
    await pool.query("DELETE FROM users WHERE id = $1", [req.user.id])
    
    res.json({ message: "Account deleted successfully" })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
