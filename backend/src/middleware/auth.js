const jwt = require("jsonwebtoken")
const pool = require("../db")

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization || ""
  const parts = authHeader.split(" ")
  const token = parts[0] === "Bearer" ? parts[1] : null

  if (!token) {
    return res.status(401).json({ error: "No token" })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const result = await pool.query(
      "SELECT id, role, is_super_admin, status, verified FROM users WHERE id = $1",
      [decoded.id]
    )

    if (!result.rows[0]) {
      return res.status(401).json({ error: "Session expired. Please log in again." })
    }

    req.user = {
      ...decoded,
      id: result.rows[0].id,
      role: result.rows[0].role,
      is_super_admin: Boolean(result.rows[0].is_super_admin),
      status: result.rows[0].status,
      verified: Boolean(result.rows[0].verified),
    }
    next()
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid token" })
    }
    console.error("Auth check failed:", error.message)
    res.status(401).json({ error: "Invalid token" })
  }
}
