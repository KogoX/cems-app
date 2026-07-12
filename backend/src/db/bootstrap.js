async function bootstrapDatabase(pool) {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      location TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('farmer', 'manager', 'buyer')),
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT")
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT")
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active'")
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS yields (
      id BIGSERIAL PRIMARY KEY,
      farmer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      crop_season TEXT NOT NULL,
      variety TEXT NOT NULL DEFAULT 'Avocado (Hass)',
      quantity NUMERIC(12, 2) NOT NULL,
      grade TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Logged',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query("ALTER TABLE yields ADD COLUMN IF NOT EXISTS variety TEXT NOT NULL DEFAULT 'Avocado (Hass)'")
  await pool.query("ALTER TABLE yields ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Logged'")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      produce TEXT NOT NULL DEFAULT 'Avocado (Hass)',
      quantity NUMERIC(12, 2) NOT NULL,
      unit_price NUMERIC(12, 2) NOT NULL DEFAULT 1200,
      total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Processing',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2) NOT NULL DEFAULT 1200")
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0")
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Processing'")
  await pool.query("UPDATE orders SET total_amount = quantity * unit_price WHERE total_amount = 0")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(14, 2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending'")
}

module.exports = { bootstrapDatabase }
