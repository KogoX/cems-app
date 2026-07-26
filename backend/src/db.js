const { Pool } = require("pg")
require("dotenv").config()

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  throw new Error("DATABASE_URL is required")
}

function parsePgUrl(urlStr) {
  // Strip query parameters (e.g. ?sslmode=require)
  const cleanUrl = urlStr.replace(/\?.*$/, "")
  // Remove protocol
  const withoutProto = cleanUrl.replace(/^postgres(ql)?:\/\//, "")
  
  // Find last '@' which separates credentials from host:port/database
  const lastAtIndex = withoutProto.lastIndexOf("@")
  if (lastAtIndex === -1) {
    throw new Error("Invalid DATABASE_URL format")
  }
  
  const creds = withoutProto.substring(0, lastAtIndex)
  const hostPath = withoutProto.substring(lastAtIndex + 1)
  
  // Credentials: user:password
  const firstColon = creds.indexOf(":")
  const user = decodeURIComponent(creds.substring(0, firstColon))
  const password = decodeURIComponent(creds.substring(firstColon + 1))
  
  // HostPath: host:port/database
  const [hostPort, database] = hostPath.split("/")
  const [host, portStr] = hostPort.split(":")
  const port = portStr ? parseInt(portStr, 10) : 5432
  
  return { user, password, host, port, database: database || "postgres" }
}

const config = parsePgUrl(dbUrl)
const useSsl = process.env.DATABASE_SSL !== "false"

const pool = new Pool({
  ...config,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
})

// Handle background idle client errors without crashing the server process
pool.on("error", (err) => {
  console.warn("[db] Background idle database connection dropped:", err.message)
})

/**
 * Execute a set of database operations inside an isolated SQL transaction.
 * Automatically acquires a client from the pool, begins a transaction,
 * and handles commit/rollback + client release.
 */
async function withTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await callback(client)
    await client.query("COMMIT")
    return result
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

module.exports = pool
module.exports.withTransaction = withTransaction
