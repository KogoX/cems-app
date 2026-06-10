const express = require("express")
const cors = require("cors")
require("dotenv").config()

const app = express()
app.use(cors())
app.use(express.json())

app.use("/api/auth", require("./routes/auth"))
app.use("/api/farmers", require("./routes/farmers"))
app.use("/api/yields", require("./routes/yields"))
app.use("/api/orders", require("./routes/orders"))
app.use("/api/payments", require("./routes/payments"))

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`)
})