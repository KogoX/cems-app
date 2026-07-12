const express = require("express")
const cors = require("cors")
require("dotenv").config()

const pool = require("./db")
const { bootstrapDatabase } = require("./db/bootstrap")

const app = express()
app.use(cors())
app.use(express.json())

app.get("/api/health", async (_req, res) => {
  const result = await pool.query("SELECT NOW() AS server_time")
  res.json({ ok: true, serverTime: result.rows[0].server_time })
})

app.use("/api/auth", require("./routes/auth"))
app.use("/api/farmers", require("./routes/farmers"))
app.use("/api/yields", require("./routes/yields"))
app.use("/api/orders", require("./routes/orders"))
app.use("/api/payments", require("./routes/payments"))

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ error: "Internal server error" })
})

async function start() {
  await bootstrapDatabase(pool)
  const port = process.env.PORT || 5000
  app.listen(port, () => {
    console.log(`API listening on port ${port}`)
  })
}

start().catch((error) => {
  console.error("Failed to start backend:", error)
  process.exit(1)
})

module.exports = app
