const router = require("express").Router()
const pool = require("../db")
const auth = require("../middleware/auth")

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

function isRemotePhoto(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value)
}

function demoPhoto(index) {
  return DEMO_PHOTOS[index % DEMO_PHOTOS.length]
}

const managerOnly = (req, res) => {
  if (req.user.role !== "manager") {
    res.status(403).json({ error: "Managers only" })
    return false
  }
  return true
}

router.get("/", auth, async (req, res) => {
  try {
    const whereConditions = []
    const values = []

    if (req.user.role === "farmer") {
      values.push(req.user.id)
      whereConditions.push(`y.farmer_id = $${values.length}`)
    }

    if (req.query.startDate) {
      values.push(req.query.startDate)
      whereConditions.push(`y.created_at >= $${values.length}`)
    }

    if (req.query.endDate) {
      const end = req.query.endDate.includes("T") ? req.query.endDate : `${req.query.endDate}T23:59:59.999Z`
      values.push(end)
      whereConditions.push(`y.created_at <= $${values.length}`)
    }

    const where = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    const limit = parseInt(req.query.limit) || 50
    const offset = parseInt(req.query.offset) || 0
    
    // Add pagination params
    values.push(limit, offset)
    const limitIdx = values.length - 1
    const offsetIdx = values.length

    const photosSelect = `
      COALESCE(
        (
          SELECT json_agg(photo_url)
          FROM (
            SELECT COALESCE(thumbnail_url, image_url) AS photo_url
            FROM yield_photos
            WHERE yield_id = y.id
              AND COALESCE(thumbnail_url, image_url) IS NOT NULL
            ORDER BY created_at ASC
            LIMIT 1
          ) sub
        ),
        '[]'::json
      ) AS photos
    `

    const result = await pool.query(
      `
      SELECT
        y.id,
        y.farmer_id,
        u.name AS farmer,
        y.crop_season,
        y.variety,
        y.quantity,
        y.grade,
        y.status,
        y.created_at,
        ${photosSelect}
      FROM yields y
      LEFT JOIN users u ON y.farmer_id = u.id
      ${where}
      ORDER BY y.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      values
    )

    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.get("/:id/photos", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COALESCE(image_url, image_data) AS photo
       FROM yield_photos
       WHERE yield_id = $1
         AND COALESCE(image_url, image_data) IS NOT NULL
       ORDER BY created_at ASC`,
      [req.params.id]
    )
    res.json(result.rows.map((r) => r.photo))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.post("/", auth, async (req, res) => {
  const { cropSeason, variety, quantity, grade, date, farmer_id, photos } = req.body

  if (!cropSeason || !quantity || !grade) {
    return res.status(400).json({ error: "cropSeason, quantity and grade are required" })
  }

  const farmerId = req.user.role === "farmer" ? req.user.id : farmer_id
  if (!farmerId) {
    return res.status(400).json({ error: "farmer_id is required" })
  }

  try {
    const farmerCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'farmer'",
      [farmerId]
    )
    if (!farmerCheck.rows[0]) {
      return res.status(404).json({
        error: "Farmer account not found. Please log in again or select an existing farmer from the new database.",
      })
    }

    const result = await pool.query(
      `INSERT INTO yields (farmer_id, crop_season, variety, quantity, grade, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        farmerId,
        cropSeason,
        variety || "Avocado (Hass)",
        Number(quantity),
        grade,
        date ? new Date(date) : new Date()
      ]
    )
    const yieldRecord = result.rows[0]
    const incomingPhotos = Array.isArray(photos) ? photos.slice(0, 10).filter(Boolean) : []
    const shouldStoreBase64 = process.env.STORE_HARVEST_BASE64 === "true"
    const storedPhotos = []

    for (let index = 0; index < incomingPhotos.length; index++) {
      const photo = incomingPhotos[index]
      if (isRemotePhoto(photo)) {
        await pool.query(
          "INSERT INTO yield_photos (yield_id, image_url, thumbnail_url) VALUES ($1, $2, $3)",
          [yieldRecord.id, photo, photo]
        )
        storedPhotos.push(photo)
        continue
      }

      if (shouldStoreBase64) {
        if (photo.length > 2 * 1024 * 1024) {
          return res.status(400).json({ error: "Each harvest photo must be under 2MB when base64 storage is enabled." })
        }
        await pool.query(
          "INSERT INTO yield_photos (yield_id, image_data) VALUES ($1, $2)",
          [yieldRecord.id, photo]
        )
        storedPhotos.push(photo)
        continue
      }

      const placeholder = demoPhoto(index)
      await pool.query(
        "INSERT INTO yield_photos (yield_id, image_url, thumbnail_url) VALUES ($1, $2, $3)",
        [yieldRecord.id, placeholder.full, placeholder.thumb]
      )
      storedPhotos.push(placeholder.thumb)
    }

    // Notify all managers
    await pool.query(`
      INSERT INTO notifications (user_id, title, message, target_url)
      SELECT id, 'New Harvest Uploaded', 'A farmer has uploaded a new harvest that requires review.', $1
      FROM users WHERE role = 'manager'
    `, [`/manager?yield=${yieldRecord.id}`])

    res.status(201).json({ ...yieldRecord, photos: storedPhotos })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

router.patch("/:id/status", auth, async (req, res) => {
  if (!managerOnly(req, res)) return

  const allowedStatuses = new Set(["Logged", "Approved", "Scheduled", "Exported", "Rejected"])
  const { status } = req.body

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid yield status" })
  }

  try {
    const result = await pool.query(
      `UPDATE yields
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Yield not found" })
    }

    const updatedYield = result.rows[0]

    if (status === "Approved") {
      // Notify the farmer
      await pool.query(
        "INSERT INTO notifications (user_id, title, message, target_url) VALUES ($1, $2, $3, $4)",
        [updatedYield.farmer_id, "Harvest Approved", "Your harvest has been approved and is now listed on the marketplace.", `/farmer?yield=${updatedYield.id}`]
      )

      // Notify all buyers
      await pool.query(`
        INSERT INTO notifications (user_id, title, message, target_url)
        SELECT id, 'New Harvest Available', 'A new verified harvest has been added to the marketplace.', $1
        FROM users WHERE role = 'buyer'
      `, [`/buyer?yield=${updatedYield.id}`])
    }

    res.json(updatedYield)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
