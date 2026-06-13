const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:Kipchumba,1@db.pvaeuqtyiyrzqdbjjise.supabase.co:5432/postgres' });
pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'", (err, res) => {
  if (err) console.error(err);
  else console.log(res.rows.map(r => r.table_name));
  pool.end();
});
