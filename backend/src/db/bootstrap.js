const bcrypt = require("bcryptjs")

const DEMO_PASSWORD = "password123"
const DEMO_PHOTOS = [
  {
    full: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=320&q=60",
  },
  {
    full: "https://images.unsplash.com/photo-1601039641847-7857b994d704?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1601039641847-7857b994d704?auto=format&fit=crop&w=320&q=60",
  },
  {
    full: "https://images.unsplash.com/photo-1590005354167-6da97870c757?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1590005354167-6da97870c757?auto=format&fit=crop&w=320&q=60",
  },
]

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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ;

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
      image_data TEXT,
      image_url TEXT,
      thumbnail_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE yield_photos ALTER COLUMN image_data DROP NOT NULL;
    ALTER TABLE yield_photos ADD COLUMN IF NOT EXISTS image_url TEXT;
    ALTER TABLE yield_photos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

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
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS yield_id UUID;
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
    CREATE INDEX IF NOT EXISTS idx_yield_photos_thumbnail_url ON yield_photos(thumbnail_url) WHERE thumbnail_url IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_farmer_id ON orders(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_yield_id ON orders(yield_id);
    CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_buyer_id ON payments(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
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

    WITH ranked_photos AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY created_at, id) AS row_num
      FROM yield_photos
      WHERE image_url IS NULL
        AND thumbnail_url IS NULL
    )
    UPDATE yield_photos yp
    SET
      image_url = CASE ranked_photos.row_num % 4
        WHEN 0 THEN 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=1200&q=80'
        WHEN 1 THEN 'https://images.unsplash.com/photo-1601039641847-7857b994d704?auto=format&fit=crop&w=1200&q=80'
        WHEN 2 THEN 'https://images.unsplash.com/photo-1590005354167-6da97870c757?auto=format&fit=crop&w=1200&q=80'
        ELSE 'https://images.unsplash.com/photo-1519162808019-7de1683fa2ad?auto=format&fit=crop&w=1200&q=80'
      END,
      thumbnail_url = CASE ranked_photos.row_num % 4
        WHEN 0 THEN 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=320&q=60'
        WHEN 1 THEN 'https://images.unsplash.com/photo-1601039641847-7857b994d704?auto=format&fit=crop&w=320&q=60'
        WHEN 2 THEN 'https://images.unsplash.com/photo-1590005354167-6da97870c757?auto=format&fit=crop&w=320&q=60'
        ELSE 'https://images.unsplash.com/photo-1519162808019-7de1683fa2ad?auto=format&fit=crop&w=320&q=60'
      END
    FROM ranked_photos
    WHERE yp.id = ranked_photos.id;
  `

  try {
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
    if (process.env.SEED_DEMO_DATA === "true") {
      await seedDemoData(pool)
    }
  } catch (err) {
    console.warn("Database bootstrap skipped/failed due to connection issues:", err.message)
  }
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

async function seedDemoData(pool) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  const manager = await getOrCreateDemoUser(pool, {
    role: "manager",
    name: "Demo Manager",
    email: "manager.demo@cems.local",
    phone: "+254700000100",
    location: "Nairobi",
    uniqueId: "MGR01",
    passwordHash,
  })

  const farmer = await getOrCreateDemoUser(pool, {
    role: "farmer",
    name: "Dennis Kogo",
    email: "farmer.demo@cems.local",
    phone: "+254700000200",
    location: "Muranga",
    uniqueId: "BPT6P",
    passwordHash,
    managerId: manager.id,
  })

  const buyer = await getOrCreateDemoUser(pool, {
    role: "buyer",
    name: "Demo Buyer",
    email: "buyer.demo@cems.local",
    phone: "+254700000300",
    location: "Nairobi",
    uniqueId: "BUY01",
    passwordHash,
  })

  await pool.query("UPDATE users SET status = 'Active' WHERE id IN ($1, $2, $3)", [manager.id, farmer.id, buyer.id])
  await pool.query("UPDATE users SET verified = TRUE WHERE id = $1 AND role = 'manager'", [manager.id])
  await pool.query(
    "UPDATE users SET manager_id = COALESCE(manager_id, $1) WHERE id = $2 AND role = 'farmer'",
    [manager.id, farmer.id]
  )

  const harvestCount = await pool.query("SELECT COUNT(*)::int AS count FROM yields WHERE farmer_id = $1", [farmer.id])
  let harvests = []
  if (harvestCount.rows[0].count === 0) {
    const seedHarvests = [
      ["2026 Main Season", "Avocado (Hass)", 500, "A", "Approved", "2026-07-29T16:43:09.000Z"],
      ["2026 Main Season", "Avocado (Hass)", 320, "B", "Logged", "2026-07-26T12:58:44.000Z"],
      ["2026 Short Season", "Avocado (Fuerte)", 180, "C", "Scheduled", "2026-07-23T16:50:32.000Z"],
    ]

    for (const [cropSeason, variety, quantity, grade, status, createdAt] of seedHarvests) {
      const result = await pool.query(
        `INSERT INTO yields (farmer_id, crop_season, variety, quantity, grade, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [farmer.id, cropSeason, variety, quantity, grade, status, createdAt]
      )
      harvests.push(result.rows[0])
    }
  } else {
    const existing = await pool.query(
      "SELECT * FROM yields WHERE farmer_id = $1 ORDER BY created_at DESC LIMIT 3",
      [farmer.id]
    )
    harvests = existing.rows
  }

  for (let index = 0; index < harvests.length; index++) {
    const harvest = harvests[index]
    const photoCount = await pool.query("SELECT COUNT(*)::int AS count FROM yield_photos WHERE yield_id = $1", [harvest.id])
    if (photoCount.rows[0].count === 0) {
      const photo = DEMO_PHOTOS[index % DEMO_PHOTOS.length]
      await pool.query(
        "INSERT INTO yield_photos (yield_id, image_url, thumbnail_url) VALUES ($1, $2, $3)",
        [harvest.id, photo.full, photo.thumb]
      )
    }
  }

  const approvedHarvest = harvests.find((harvest) => harvest.status === "Approved") || harvests[0]
  const orderCount = await pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE buyer_id = $1", [buyer.id])
  let order = null
  if (approvedHarvest && orderCount.rows[0].count === 0) {
    const quantity = Math.min(Number(approvedHarvest.quantity), 500)
    const unitPrice = 1200
    const orderResult = await pool.query(
      `INSERT INTO orders (
         buyer_id, farmer_id, yield_id, produce, quantity, unit_price, total_amount,
         status, tracking_location, estimated_delivery, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'In Transit', 'Nairobi Consolidation Hub', $8, $9)
       RETURNING *`,
      [
        buyer.id,
        farmer.id,
        approvedHarvest.id,
        approvedHarvest.variety,
        quantity,
        unitPrice,
        quantity * unitPrice,
        "2026-08-04T09:00:00.000Z",
        "2026-07-29T16:43:09.000Z",
      ]
    )
    order = orderResult.rows[0]
  } else {
    const existingOrder = await pool.query(
      "SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 1",
      [buyer.id]
    )
    order = existingOrder.rows[0] || null
  }

  if (order) {
    const paymentCount = await pool.query("SELECT COUNT(*)::int AS count FROM payments WHERE order_id = $1", [order.id])
    if (paymentCount.rows[0].count === 0) {
      await pool.query(
        `INSERT INTO payments (order_id, buyer_id, amount, status, method, currency, paystack_reference, created_at)
         VALUES ($1, $2, $3, 'Verified', 'card', 'KES', $4, $5)`,
        [order.id, buyer.id, order.total_amount, `DEMO-${order.id}`, "2026-07-29T16:45:00.000Z"]
      )
    }
  }

  const payoutCount = await pool.query("SELECT COUNT(*)::int AS count FROM payouts WHERE farmer_id = $1", [farmer.id])
  if (payoutCount.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO payouts (farmer_id, order_id, amount, method, status, reference, notes, created_at, processed_at)
       VALUES
         ($1, $2, 60000, 'cash', 'Paid', 'DEMO-PAID-001', 'Demo farmer payout', '2026-07-23T16:50:32.000Z', '2026-07-23T17:10:00.000Z'),
         ($1, $2, 120000, 'mpesa', 'Processing', 'DEMO-MPESA-001', 'Demo payout in processing', '2026-07-26T12:58:44.000Z', NULL),
         ($1, $2, 120000, 'mpesa', 'Processing', 'DEMO-MPESA-002', 'Demo payout in processing', '2026-07-29T16:43:09.000Z', NULL)`,
      [farmer.id, order?.id || null]
    )
  }
}

async function getOrCreateDemoUser(pool, user) {
  const existingRole = await pool.query(
    "SELECT * FROM users WHERE role = $1 ORDER BY created_at ASC LIMIT 1",
    [user.role]
  )
  if (existingRole.rows[0]) {
    return existingRole.rows[0]
  }

  const existingEmail = await pool.query("SELECT * FROM users WHERE email = $1", [user.email])
  if (existingEmail.rows[0]) {
    return existingEmail.rows[0]
  }

  const existingCode = await pool.query("SELECT * FROM users WHERE unique_id = $1", [user.uniqueId])
  if (existingCode.rows[0]) {
    return existingCode.rows[0]
  }

  const result = await pool.query(
    `INSERT INTO users (
       name, email, phone, location, password_hash, role, status, unique_id,
       manager_id, verified, national_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, $8, $9, $10)
     RETURNING *`,
    [
      user.name,
      user.email,
      user.phone,
      user.location,
      user.passwordHash,
      user.role,
      user.uniqueId,
      user.managerId || null,
      user.role === "manager",
      user.role === "manager" ? "DEMO-MGR" : null,
    ]
  )
  return result.rows[0]
}

module.exports = { bootstrapDatabase }
