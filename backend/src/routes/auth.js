const router = require("express").Router()
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")

const pool = require("../db")
const auth = require("../middleware/auth")

const allowedRoles = new Set(["farmer", "manager", "buyer"])

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
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, location)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, email, phone, role, location`,
      [name, email.toLowerCase().trim(), phone || null, hash, role, location || null]
    )

    const user = result.rows[0]
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" })
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
      return res.status(404).json({ error: "User not found" })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: "Wrong password" })
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" })
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        location: user.location
      }
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/me", auth, async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, email, phone, role, location, status, created_at FROM users WHERE id = $1",
    [req.user.id]
  )
  if (!result.rows[0]) {
    return res.status(404).json({ error: "User not found" })
  }
  res.json(result.rows[0])
})

router.get("/users", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Managers only" })
  }

  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        email,
        phone,
        role,
        location,
        status,
        created_at
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
       RETURNING id, name, email, phone, role, location, status, created_at`,
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

module.exports = router
