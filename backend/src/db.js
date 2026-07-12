const { Pool } = require("pg")
require("dotenv").config()

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required")
}

const useSsl = process.env.DATABASE_SSL !== "false"
const connectionString = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*/i, "$1").replace(/[?&]$/, "")

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false
})

module.exports = pool
