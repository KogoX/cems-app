const { Pool } = require("pg");
require("dotenv").config();

// Standard breakdown of your string parameters:
// postgresql://postgres.yzjshccolwluzsvtwaap:Kipchumba%401@aws-1-eu-central-1.pooler.supabase.com:5432/postgres

const pool = new Pool({
  user: "postgres.yzjshccolwluzsvtwaap",
  password: "Kipchumba@1", // Use the raw un-encoded password here since it isn't part of a URI!
  host: "aws-1-eu-central-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  // Bypasses the self-signed certificate restriction successfully
  ssl: {
    rejectUnauthorized: false
  }
});

// Run a clear connection check log
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Supabase Connection Failed:', err.message);
  } else {
    console.log('✅ db.js connected over IPv4!');
  }
});

module.exports = pool;