const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/farmers", require("./routes/farmers"));
app.use("/api/yields", require("./routes/yields"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/payments", require("./routes/payments"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Local network access point: http://10.37.94.63:${PORT}`);
});

module.exports = app;