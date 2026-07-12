const { Pool } = require("pg")
require("dotenv").config()

async function listTables() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required")
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  const result = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  )
  console.log(result.rows.map((row) => row.table_name))
  await pool.end()
}

listTables().catch((error) => {
  console.error(error)
  process.exit(1)
})
