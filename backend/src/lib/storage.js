try {
  if (typeof global.WebSocket === "undefined") {
    global.WebSocket = require("ws")
  }
} catch {}

const { createClient } = require("@supabase/supabase-js")
const crypto = require("crypto")

const supabaseUrl = process.env.SUPABASE_URL || (process.env.DATABASE_URL ? extractSupabaseProjectUrl(process.env.DATABASE_URL) : null)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

let supabase = null
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  } catch (err) {
    console.warn("Failed to initialize Supabase storage client:", err.message)
  }
}

function extractSupabaseProjectUrl(dbUrl) {
  if (!dbUrl) return null
  const match = dbUrl.match(/postgres\.([a-z0-9]+):/)
  if (match && match[1]) {
    return `https://${match[1]}.supabase.co`
  }
  return null
}

/**
 * Upload a Base64 or remote image to Supabase Storage bucket ('harvest-photos').
 * Returns the public CDN URL of the uploaded file if Supabase storage is configured,
 * or null if Supabase storage is unavailable.
 */
async function uploadToSupabaseStorage(base64Data, bucketName = "harvest-photos") {
  if (!supabase) return null

  try {
    // Strip data URI prefix if present (e.g. data:image/jpeg;base64,...)
    const matches = base64Data.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/)
    let mimeType = "image/jpeg"
    let buffer

    if (matches) {
      mimeType = matches[1]
      buffer = Buffer.from(matches[2], "base64")
    } else {
      buffer = Buffer.from(base64Data, "base64")
    }

    const ext = mimeType.split("/")[1] || "jpg"
    const filename = `harvest_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`

    // 5-second max timeout race so slow storage network requests don't hang farmer submissions
    const uploadPromise = (async () => {
      let { data, error } = await supabase.storage
        .from(bucketName)
        .upload(filename, buffer, {
          contentType: mimeType,
          upsert: true,
        })

      if (error && (error.message?.includes("not found") || error.statusCode === "404" || error.error === "Bucket not found")) {
        await supabase.storage.createBucket(bucketName, { public: true }).catch(() => {})
        const retry = await supabase.storage
          .from(bucketName)
          .upload(filename, buffer, {
            contentType: mimeType,
            upsert: true,
          })
        data = retry.data
        error = retry.error
      }

      if (error) {
        if (error.message?.includes("violates row-level security policy") || error.statusCode === "403") {
          console.warn("Supabase Storage Warning: Upload blocked by Row-Level Security (RLS) policy. To enable direct uploads, set SUPABASE_SERVICE_ROLE_KEY in .env or add a public INSERT policy in Supabase Dashboard.")
        } else {
          console.warn("Supabase storage upload warning:", error.message)
        }
        return null
      }

      const { data: publicUrlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(data.path)

      return publicUrlData?.publicUrl || null
    })()

    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 5000))
    return await Promise.race([uploadPromise, timeoutPromise])
  } catch (err) {
    console.warn("Error uploading to Supabase storage:", err.message)
    return null
  }
}

module.exports = {
  uploadToSupabaseStorage,
  supabaseUrl,
}
