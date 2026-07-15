const { Pool } = require("pg")
require("dotenv").config()

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required")
}

const useSsl = process.env.DATABASE_SSL !== "false"
const connectionString = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*/i, "$1").replace(/[?&]$/, "")

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 5,                    // transaction-mode pooler supports many connections
  idleTimeoutMillis: 10000,  // release idle connections after 10 s
  connectionTimeoutMillis: 5000, // fail fast if no connection available within 5 s
})

module.exports = pool
