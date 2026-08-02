const pool = require("../db")

async function resetDatabase() {
  console.log("Wiping database tables...")

  const tables = [
    "yield_photos",
    "yields",
    "payments",
    "payouts",
    "orders",
    "notifications",
    "users"
  ]

  try {
    // Truncate all tables with CASCADE to handle foreign key references cleanly
    await pool.query(
      `TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE;`
    )
    console.log("Successfully wiped all data from the database!")
  } catch (error) {
    console.error("Error wiping database:", error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

resetDatabase()
