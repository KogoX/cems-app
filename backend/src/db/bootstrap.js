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
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT")
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT")
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending'")
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS yields (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      farmer_id UUID REFERENCES users(id) ON DELETE CASCADE,
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
    CREATE TABLE IF NOT EXISTS yield_photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      yield_id UUID REFERENCES yields(id) ON DELETE CASCADE,
      image_data TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
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
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS farmer_id UUID")
  await ensureOrderYieldIdUuid(pool)
  await pool.query("UPDATE orders SET total_amount = quantity * unit_price WHERE total_amount = 0")

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(14, 2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending'")
}

async function ensureOrderYieldIdUuid(pool) {
  const result = await pool.query(`
    SELECT udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'yield_id'
  `)

  const column = result.rows[0]
  if (!column) {
    await pool.query("ALTER TABLE orders ADD COLUMN yield_id UUID")
    return
  }

  if (column.udt_name !== "uuid") {
    await pool.query("ALTER TABLE orders DROP COLUMN yield_id")
    await pool.query("ALTER TABLE orders ADD COLUMN yield_id UUID")
  }
}

module.exports = { bootstrapDatabase }
