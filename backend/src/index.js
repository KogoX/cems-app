const express = require("express")
const cors = require("cors")
require("dotenv").config()

const pool = require("./db")
const paystack = require("./lib/paystack")
const { bootstrapDatabase } = require("./db/bootstrap")

const app = express()
app.use(cors())

app.get("/api/health", async (_req, res) => {
  const result = await pool.query("SELECT NOW() AS server_time")
  res.json({ ok: true, serverTime: result.rows[0].server_time })
})

app.post("/api/payments/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["x-paystack-signature"]
  const rawBody = req.body
  if (!paystack.verifyWebhookSignature(rawBody, signature)) {
    return res.status(400).json({ error: "Invalid signature" })
  }

  try {
    const event = JSON.parse(rawBody.toString())
    if (event.event === "charge.success") {
      const reference = event.data?.reference
      const paymentResult = await pool.query("SELECT * FROM payments WHERE paystack_reference = $1", [reference])
      const payment = paymentResult.rows[0]
      if (payment && payment.status !== "Verified") {
        await pool.query("UPDATE payments SET status = 'Verified' WHERE id = $1", [payment.id])
        await pool.query("UPDATE orders SET status = 'Paid' WHERE id = $1", [payment.order_id])
      }
    } else if (event.event === "transfer.success") {
      const reference = event.data?.reference
      const payoutResult = await pool.query("SELECT * FROM payouts WHERE reference = $1", [reference])
      const payout = payoutResult.rows[0]
      if (payout && payout.status !== "Paid") {
        await pool.query("UPDATE payouts SET status = 'Paid', processed_at = NOW() WHERE id = $1", [payout.id])
      }
    }
  } catch (error) {
    console.error("Webhook processing failed:", error.message)
  }

  res.sendStatus(200)
})

app.use(express.json({ limit: "50mb" }))

app.use("/api/auth", require("./routes/auth"))
app.use("/api/farmers", require("./routes/farmers"))
app.use("/api/yields", require("./routes/yields"))
app.use("/api/orders", require("./routes/orders"))
app.use("/api/payments", require("./routes/payments"))
app.use("/api/payouts", require("./routes/payouts"))

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

// Graceful shutdown – releases DB connections so nodemon restarts don't exhaust the pool
async function shutdown() {
  await pool.end()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

module.exports = app
