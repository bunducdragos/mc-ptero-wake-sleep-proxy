import "dotenv/config"
import mc from "minecraft-protocol"
import net from "net"
import axios from "axios"
import fs from "fs"
import path from "path"

/* =========================
   ENV VALIDATION
========================= */

const REQUIRED = ["PTERO_PANEL", "PTERO_SERVER_ID", "PTERO_API_KEY"]

for (const k of REQUIRED) {
  if (!process.env[k]) {
    console.error(`❌ Missing env var: ${k}`)
    process.exit(1)
  }
}

const { LISTEN_PORT = "25565", BACKEND_HOST = "127.0.0.1", BACKEND_PORT = "25566", PTERO_PANEL, PTERO_SERVER_ID, PTERO_API_KEY, IDLE_SHUTDOWN_MINUTES = "20" } = process.env

/* =========================
   LOAD SERVER ICON
========================= */

let serverIconBase64 = null

try {
  const iconPath = path.resolve("./server-icon.png")
  if (fs.existsSync(iconPath)) {
    const iconBuffer = fs.readFileSync(iconPath)
    serverIconBase64 = `data:image/png;base64,${iconBuffer.toString("base64")}`
    console.log("✅ Loaded custom server icon from", "./server-icon.png")
  } else {
    console.log("ℹ️  No server icon found at", "./server-icon.png")
  }
} catch (err) {
  console.warn("⚠️  Failed to load server icon:", err.message)
}

/* =========================
   PTERODACTYL CLIENT
========================= */

const ptero = axios.create({
  baseURL: `${PTERO_PANEL.replace(/\/$/, "")}/api/client`,
  headers: {
    Authorization: `Bearer ${PTERO_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "Application/vnd.pterodactyl.v1+json",
  },
  timeout: 8000,
})

async function getServerState() {
  const res = await ptero.get(`/servers/${PTERO_SERVER_ID}/resources`)
  return res.data.attributes.current_state
}

async function power(signal) {
  await ptero.post(`/servers/${PTERO_SERVER_ID}/power`, { signal })
}

/* =========================
   START COOLDOWN
========================= */

let lastStart = 0

async function ensureStarted() {
  const now = Date.now()
  if (now - lastStart < 15000) return

  const state = await getServerState().catch((err) => {
    console.error("❌ Failed to get server state:", err.message)
    return "unknown"
  })
  if (state === "running" || state === "starting") return

  console.log("⚡ Starting Forge/NeoForge server...")
  lastStart = now
  try {
    await power("start")
    console.log("✅ Start signal sent successfully")
  } catch (err) {
    console.error("❌ Failed to send start signal:", err.message)
    throw err
  }
}

/* =========================
   AUTO SHUTDOWN ON IDLE
========================= */

let lastPlayerSeen = Date.now()
let shutdownTimer = null

async function checkPlayerCount() {
  try {
    const state = await getServerState()
    if (state !== "running") {
      // Server not running, reset timer
      lastPlayerSeen = Date.now()
      return
    }

    // Ping the backend server to get player count
    const status = await new Promise((resolve, reject) => {
      mc.ping({ host: BACKEND_HOST, port: Number(BACKEND_PORT) }, (err, result) => {
        if (err) reject(err)
        else resolve(result)
      })
    }).catch(() => null)

    if (!status) {
      // Can't reach server, don't shutdown
      return
    }

    const playerCount = status.players?.online || 0

    if (playerCount > 0) {
      // Players online, reset timer
      lastPlayerSeen = Date.now()
    } else {
      // No players - check if idle timeout reached
      const idleMinutes = (Date.now() - lastPlayerSeen) / 1000 / 60
      const shutdownMinutes = Number(IDLE_SHUTDOWN_MINUTES)

      if (idleMinutes >= shutdownMinutes) {
        console.log(`💤 Server idle for ${idleMinutes.toFixed(1)} minutes, shutting down...`)
        await power("stop")
        console.log("✅ Server stopped due to inactivity")
        lastPlayerSeen = Date.now() // Reset timer
      } else {
        const remaining = shutdownMinutes - idleMinutes
        console.log(`⏳ Server idle for ${idleMinutes.toFixed(1)}/${shutdownMinutes} minutes (${remaining.toFixed(1)} min until shutdown)`)
      }
    }
  } catch (err) {
    console.error("❌ Error checking player count:", err.message)
  }
}

// Check every 60 seconds
setInterval(checkPlayerCount, 60000)

/* =========================
   MOTD
========================= */

function motdForState(state) {
  switch (state) {
    case "running":
      return "§aServer is Awake! §7Join now"
    case "starting":
      return "§eWaking up..."
    case "offline":
      return "§6Server is Sleeping 💤\n§7Join to wake it up!"
    default:
      return "§7Checking server status..."
  }
}

/* =========================
   HELPER: CHECK BACKEND REACHABILITY
========================= */

async function isBackendReachable() {
  return new Promise((resolve) => {
    const socket = net.createConnection(Number(BACKEND_PORT), BACKEND_HOST)

    socket.on("connect", () => {
      socket.end()
      resolve(true)
    })

    socket.on("error", () => {
      resolve(false)
    })

    socket.on("timeout", () => {
      socket.destroy()
      resolve(false)
    })

    socket.setTimeout(2000) // 2 second timeout
  })
}

/* =========================
   RAW TCP PROXY WITH MC PROTOCOL FOR OFFLINE
========================= */

const server = net.createServer(async (clientSocket) => {
  let state = "unknown"
  let backendReachable = false

  // Get server state immediately
  try {
    state = await getServerState()
    if (state === "running") {
      backendReachable = await isBackendReachable()
    }
  } catch (err) {
    console.error("❌ Failed to get server state:", err.message)
  }

  console.log(`🔌 New connection (Ptero: ${state}, Backend: ${backendReachable ? "up" : "down"})`)

  if (state === "running" && backendReachable) {
    // Server is running AND backend is reachable - do immediate raw TCP proxy
    const upstream = net.connect(Number(BACKEND_PORT), BACKEND_HOST)

    let connected = false

    upstream.on("connect", () => {
      console.log(`🔗 Raw TCP proxy to ${BACKEND_HOST}:${BACKEND_PORT}`)
      connected = true
    })

    upstream.on("error", (err) => {
      console.error(`❌ Upstream error:`, err.message)
      if (!clientSocket.destroyed) clientSocket.destroy()
    })

    clientSocket.on("error", (err) => {
      if (!upstream.destroyed) upstream.destroy()
    })

    upstream.on("close", () => {
      if (!clientSocket.destroyed) clientSocket.end()
    })

    clientSocket.on("close", () => {
      if (!upstream.destroyed) upstream.end()
    })

    // Bidirectional pipe - do this immediately
    clientSocket.pipe(upstream)
    upstream.pipe(clientSocket)
  } else {
    // Server is offline/starting OR backend not reachable - use minecraft-protocol to handle
    // Determine effective state for MOTD
    let effectiveState = !backendReachable && state === "running" ? "offline" : state

    // If we recently sent a start signal, show "starting" state
    const timeSinceStart = Date.now() - lastStart
    if (timeSinceStart < 30000 && effectiveState === "offline") {
      effectiveState = "starting"
    }

    // Create a temporary MC server for this connection
    const mcServer = mc.createServer({
      host: "127.0.0.1",
      port: 0,
      version: false,
      motd: motdForState(effectiveState),
      "online-mode": false,
      maxPlayers: 0,
      favicon: serverIconBase64 || undefined,
    })

    mcServer.on("listening", () => {
      // Hand off the socket to the MC server
      mcServer.socketServer.emit("connection", clientSocket)
    })

    mcServer.on("ping", (response) => {
      response.description = motdForState(effectiveState)
      response.players = {
        max: 0,
        online: 0,
        sample: [{ name: "Server is sleeping 💤", id: "00000000-0000-0000-0000-000000000000" }],
      }
      // Set custom server icon if available
      if (serverIconBase64) {
        response.favicon = serverIconBase64
        console.log("🖼️  Sending custom server icon")
      } else {
        delete response.favicon
        console.log("⚠️  No server icon to send")
      }
    })

    mcServer.on("login", async (client) => {
      console.log(`👤 ${client.username} tried to join while ${effectiveState}`)

      try {
        await ensureStarted()
        client.end("§6Server is waking up! 💤➡️⚡\n§7Please reconnect in ~30-60 seconds.")
      } catch (err) {
        console.error("❌ Error starting:", err.message)
        client.end("§cFailed to start server. Try again later.")
      }

      setTimeout(() => mcServer.close(), 1000)
    })
  }
})

server.listen(Number(LISTEN_PORT), () => {
  console.log(`🚪 Gate listening on localhost:${LISTEN_PORT}`)
  console.log(`🎮 Backend at ${BACKEND_HOST}:${BACKEND_PORT}`)
})
