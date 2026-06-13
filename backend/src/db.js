const { Pool } = require("pg");
require("dotenv").config();

// Fix the URL parsing issue if there's an unencoded '@' in the password
let dbUrl = process.env.DATABASE_URL || "";
// If the url contains two @ symbols, it means the password has one and it wasn't encoded.
if ((dbUrl.match(/@/g) || []).length > 1) {
  // Replace the first '@' with '%40' assuming the format is postgres://user:pass@host...
  dbUrl = dbUrl.replace('@', '%40');
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false } // Needed for Supabase
});

module.exports = pool;
