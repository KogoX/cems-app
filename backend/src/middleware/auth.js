const jwt = require("jsonwebtoken")

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization || ""
  const parts = authHeader.split(" ")
  const token = parts[0] === "Bearer" ? parts[1] : null

  if (!token) {
    return res.status(401).json({ error: "No token" })
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch (_error) {
    res.status(401).json({ error: "Invalid token" })
  }
}