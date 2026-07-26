async function bootstrapDatabase(pool) {
  const batchSql = `
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS unique_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_details TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_unique_id_key'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_unique_id_key UNIQUE (unique_id);
      END IF;
    END;
    $$;

    CREATE TABLE IF NOT EXISTS yields (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      farmer_id UUID REFERENCES users(id) ON DELETE CASCADE,
      crop_season TEXT NOT NULL,
      variety TEXT NOT NULL DEFAULT 'Avocado (Hass)',
      quantity NUMERIC(12, 2) NOT NULL,
      grade TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Logged',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE yields ADD COLUMN IF NOT EXISTS variety TEXT NOT NULL DEFAULT 'Avocado (Hass)';
    ALTER TABLE yields ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Logged';

    CREATE TABLE IF NOT EXISTS yield_photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      yield_id UUID REFERENCES yields(id) ON DELETE CASCADE,
      image_data TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
      produce TEXT NOT NULL DEFAULT 'Avocado (Hass)',
      quantity NUMERIC(12, 2) NOT NULL,
      unit_price NUMERIC(12, 2) NOT NULL DEFAULT 1200,
      total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Processing',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2) NOT NULL DEFAULT 1200;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Processing';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS farmer_id UUID;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_location TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
      buyer_id UUID REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(14, 2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending';
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'KES';

    CREATE TABLE IF NOT EXISTS payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      farmer_id UUID REFERENCES users(id) ON DELETE CASCADE,
      order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
      amount NUMERIC(14, 2) NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('mpesa', 'bank', 'cash', 'airtel')),
      status TEXT NOT NULL DEFAULT 'Pending',
      reference TEXT,
      paystack_transfer_code TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payouts_method_check'
      ) THEN
        ALTER TABLE payouts DROP CONSTRAINT payouts_method_check;
        ALTER TABLE payouts ADD CONSTRAINT payouts_method_check CHECK (method IN ('mpesa', 'bank', 'cash', 'airtel'));
      END IF;
    END;
    $$;
    ALTER TABLE payouts ADD COLUMN IF NOT EXISTS reference TEXT;
    ALTER TABLE payouts ADD COLUMN IF NOT EXISTS paystack_transfer_code TEXT;
    ALTER TABLE payouts ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE payouts ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      target_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_url TEXT;

    CREATE INDEX IF NOT EXISTS idx_yields_farmer_id ON yields(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_yield_photos_yield_id ON yield_photos(yield_id);
    CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_farmer_id ON orders(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_yield_id ON orders(yield_id);
    CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_buyer_id ON payments(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_farmer_id ON payouts(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_order_id ON payouts(order_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
    CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_yields_status ON yields(status);
    CREATE INDEX IF NOT EXISTS idx_yields_created_at ON yields(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
    CREATE INDEX IF NOT EXISTS idx_payouts_created_at ON payouts(created_at DESC);
  `

  await pool.query(batchSql)

  // Backfill unassigned unique IDs
  const unassigned = await pool.query("SELECT id FROM users WHERE unique_id IS NULL")
  for (const row of unassigned.rows) {
    let code = ""
    while (true) {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
      let generated = ""
      for (let i = 0; i < 5; i++) {
        generated += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      const duplicate = await pool.query("SELECT id FROM users WHERE unique_id = $1", [generated])
      if (duplicate.rows.length === 0) {
        code = generated
        break
      }
    }
    await pool.query("UPDATE users SET unique_id = $1 WHERE id = $2", [code, row.id])
  }

  await ensureOrderYieldIdUuid(pool)
  await pool.query("UPDATE orders SET total_amount = quantity * unit_price WHERE total_amount = 0")
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
