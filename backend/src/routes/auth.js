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
    let isSuperAdmin = false
    let status = "Active"
    let verified = false

    if (role === "manager") {
      const managerCheck = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'manager'")
      const existingManagers = Number(managerCheck.rows[0].count)
      if (existingManagers === 0) {
        // First manager to register becomes the Super Admin
        isSuperAdmin = true
        status = "Active"
        verified = true
      } else {
        // Subsequent manager registering must be approved by Super Admin
        isSuperAdmin = false
        status = "Pending"
        verified = false
      }
    }

    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, location, status, verified, is_super_admin, unique_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, email, phone, role, location, status, verified, is_super_admin, unique_id`,
      [
        name.trim(),
        email.toLowerCase().trim(),
        phone || null,
        hash,
        role,
        location || null,
        status,
        verified,
        isSuperAdmin,
        uniqueId,
      ]
    )

    const user = result.rows[0]
    const formattedUser = {
      ...user,
      is_super_admin: Boolean(user.is_super_admin),
      verified: Boolean(user.verified)
    }

    if (role === "manager" && !isSuperAdmin) {
      return res.status(201).json({
        user: formattedUser,
        pendingApproval: true,
        message: "Manager account created! Your account is pending approval by the Super Admin manager."
      })
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "2d" })
    res.status(201).json({ token, user: formattedUser })
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already exists" })
    }
    res.status(500).json({ error: error.message })
  }
})

router.post("/managers", auth, async (req, res) => {
  if (req.user.role !== "manager" || !req.user.is_super_admin) {
    return res.status(403).json({ error: "Only the Super Admin manager can register new managers directly" })
  }

  const { name, email, phone, password, location } = req.body
  if (!name || !password || !email) {
    return res.status(400).json({ error: "name, email and password are required" })
  }

  try {
    const hash = await bcrypt.hash(password, 10)
    const uniqueId = await getUniqueId(pool)
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, location, status, verified, is_super_admin, unique_id)
       VALUES ($1,$2,$3,$4,'manager',$5,'Active',TRUE,FALSE,$6)
       RETURNING id, name, email, phone, role, location, status, verified, is_super_admin, created_at, unique_id`,
      [
        name.trim(),
        email.toLowerCase().trim(),
        phone?.trim() || null,
        hash,
        location?.trim() || null,
        uniqueId,
      ]
    )

    res.status(201).json({
      ...result.rows[0],
      is_super_admin: Boolean(result.rows[0].is_super_admin),
      verified: Boolean(result.rows[0].verified)
    })
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already exists" })
    }
    res.status(500).json({ error: error.message })
  }
})

router.post("/farmers", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Managers only" })
  }

  const { name, email, phone, password, location, payment_details } = req.body
  if (!name || !password) {
    return res.status(400).json({ error: "name and password are required" })
  }

  try {
    const hash = await bcrypt.hash(password, 10)
    const uniqueId = await getUniqueId(pool)
    const loginEmail = email?.trim()
      ? email.toLowerCase().trim()
      : `${uniqueId.toLowerCase()}@farmer.cems.local`
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, location, status, unique_id, payment_details, manager_id)
       VALUES ($1,$2,$3,$4,'farmer',$5,'Active',$6,$7,$8)
       RETURNING id, name, email, phone, role, location, status, created_at, unique_id, payment_details, manager_id`,
      [
        name.trim(),
        loginEmail,
        phone?.trim() || null,
        hash,
        location?.trim() || null,
        uniqueId,
        payment_details?.trim() || null,
        req.user.id
      ]
    )

    res.status(201).json(result.rows[0])
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

    if (user.role === "manager") {
      if (user.status === "Pending") {
        return res.status(403).json({ error: "Your manager account is pending approval by the Super Admin manager." })
      }
      if (user.status === "Suspended") {
        return res.status(403).json({ error: "Your manager account has been suspended by the Super Admin manager." })
      }
    } else if (user.status === "Suspended") {
      return res.status(403).json({ error: "Your account has been suspended." })
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
        unique_id: user.unique_id,
        status: user.status,
        verified: Boolean(user.verified),
        is_super_admin: Boolean(user.is_super_admin),
      }
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.post("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body
  if (!email || !newPassword) {
    return res.status(400).json({ error: "Email and new password are required" })
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long" })
  }

  try {
    const userCheck = await pool.query("SELECT id, email, name FROM users WHERE LOWER(email) = LOWER($1)", [email.trim()])
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "No account found with this email address" })
    }

    const hash = await bcrypt.hash(newPassword, 10)
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, userCheck.rows[0].id])

    res.json({ message: "Password reset successfully. You can now sign in with your new password." })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/me", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.phone,
       u.role,
       u.location,
       u.status,
       u.created_at,
       u.unique_id,
       u.national_id,
       u.verified,
       u.is_super_admin,
       u.payment_details,
       u.manager_id,
       manager.name AS manager_name,
       manager.email AS manager_email,
       manager.phone AS manager_phone,
       manager.unique_id AS manager_unique_id,
       manager.verified AS manager_verified
     FROM users u
     LEFT JOIN users manager ON manager.id = u.manager_id
     WHERE u.id = $1`,
    [req.user.id]
  )
  if (!result.rows[0]) {
    return res.status(404).json({ error: "User not found" })
  }
  const userRow = result.rows[0]
  res.json({
    ...userRow,
    is_super_admin: Boolean(userRow.is_super_admin),
    verified: Boolean(userRow.verified)
  })
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
       RETURNING id, name, email, phone, role, location, status, created_at, unique_id, national_id, verified, is_super_admin, payment_details, manager_id`,
      [name.trim(), phone?.trim() || null, location?.trim() || null, payment_details?.trim() || null, req.user.id]
    )
    const userRow = result.rows[0]
    res.json({
      ...userRow,
      is_super_admin: Boolean(userRow.is_super_admin),
      verified: Boolean(userRow.verified)
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/me/password", auth, async (req, res) => {
  const { newPassword } = req.body
  if (!newPassword || newPassword.trim().length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters long" })
  }

  try {
    const hash = await bcrypt.hash(newPassword.trim(), 10)
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.user.id])
    res.json({ message: "Password updated successfully" })
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
       RETURNING id, name, email, phone, role, location, status, created_at, unique_id, national_id, verified, is_super_admin`,
      [national_id.trim().toUpperCase(), req.user.id]
    )
    const userRow = result.rows[0]
    res.json({
      ...userRow,
      is_super_admin: Boolean(userRow.is_super_admin),
      verified: Boolean(userRow.verified)
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/managers/verified", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, unique_id, verified, is_super_admin
       FROM users
       WHERE role = 'manager' AND verified = TRUE
       ORDER BY name ASC`
    )
    res.json(result.rows.map(row => ({
      ...row,
      is_super_admin: Boolean(row.is_super_admin),
      verified: Boolean(row.verified)
    })))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/me/manager", auth, async (req, res) => {
  if (req.user.role !== "farmer") {
    return res.status(403).json({ error: "Only farmers can link to a manager" })
  }

  const { manager_id } = req.body
  if (!manager_id) {
    return res.status(400).json({ error: "manager_id is required" })
  }

  try {
    const manager = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'manager' AND verified = TRUE",
      [manager_id]
    )
    if (!manager.rows[0]) {
      return res.status(404).json({ error: "Verified manager not found" })
    }

    const result = await pool.query(
      `UPDATE users
       SET manager_id = $1
       WHERE id = $2
       RETURNING id, name, email, phone, role, location, status, created_at, unique_id, national_id, verified, is_super_admin, payment_details, manager_id`,
      [manager_id, req.user.id]
    )

    const linkedProfile = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.phone,
         u.role,
         u.location,
         u.status,
         u.created_at,
         u.unique_id,
         u.national_id,
         u.verified,
         u.is_super_admin,
         u.payment_details,
         u.manager_id,
         manager.name AS manager_name,
         manager.email AS manager_email,
         manager.phone AS manager_phone,
         manager.unique_id AS manager_unique_id,
         manager.verified AS manager_verified
       FROM users u
       LEFT JOIN users manager ON manager.id = u.manager_id
       WHERE u.id = $1`,
      [result.rows[0].id]
    )

    const userRow = linkedProfile.rows[0]
    res.json({
      ...userRow,
      is_super_admin: Boolean(userRow.is_super_admin),
      verified: Boolean(userRow.verified)
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/users", auth, async (req, res) => {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "Managers only" })
  }

  try {
    const limit = parseInt(req.query.limit) || 50
    const offset = parseInt(req.query.offset) || 0

    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.role,
        u.location,
        u.status,
        u.created_at,
        u.unique_id,
        u.national_id,
        u.verified,
        u.is_super_admin,
        u.payment_details,
        u.manager_id,
        manager.name AS manager_name
      FROM users u
      LEFT JOIN users manager ON manager.id = u.manager_id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset])

    res.json(result.rows.map(row => ({
      ...row,
      is_super_admin: Boolean(row.is_super_admin),
      verified: Boolean(row.verified)
    })))
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
    const targetQuery = await pool.query("SELECT id, role, is_super_admin FROM users WHERE id = $1", [req.params.id])
    if (!targetQuery.rows[0]) {
      return res.status(404).json({ error: "User not found" })
    }

    const target = targetQuery.rows[0]

    // Only the Super Admin manager can update another manager's status
    if (target.role === "manager") {
      if (!req.user.is_super_admin) {
        return res.status(403).json({ error: "Only the Super Admin manager can approve or change status of other managers" })
      }
      if (target.is_super_admin && status !== "Active") {
        return res.status(400).json({ error: "The Super Admin manager status cannot be suspended or changed to pending" })
      }
    }

    const setVerified = status === "Active" ? true : false

    const result = await pool.query(
      `UPDATE users
       SET status = $1, verified = CASE WHEN $2::boolean THEN TRUE ELSE verified END
       WHERE id = $3
       RETURNING id, name, email, phone, role, location, status, created_at, unique_id, verified, is_super_admin`,
      [status, setVerified, req.params.id]
    )

    const updatedUser = result.rows[0]
    res.json({
      ...updatedUser,
      is_super_admin: Boolean(updatedUser.is_super_admin),
      verified: Boolean(updatedUser.verified)
    })
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
