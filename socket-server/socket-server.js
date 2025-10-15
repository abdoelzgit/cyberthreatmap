// socket-server-threatmap.js - Simplified threat map mode
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const {
  getAttackLocationsWithGeo,
  getCentersFromDatabase,
  getHistoricalAttacks,
} = require("../ip-geolocation");

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: "*" } });
const PORT = 4000;

// CONFIG
const EARTH_RADIUS = 6371000;
const ATTACK_SPEED_MPS = 30000; // incoming missile speed (m/s) - increased for faster visualization
const UPDATE_INTERVAL = 800; // ms — event generation interval - reduced for more frequent attacks
const SIM_STEP_MS = 50; // ms — interval untuk update simulasi posisi (20 updates/detik untuk smoother animation)

// Dynamic locations from database geolocation
let LOCATIONS = [];
let CENTERS = []; // Will be loaded from database
let HISTORICAL_ATTACKS = []; // Will be loaded from database
let attackIndex = 0; // Index for replaying historical attacks
let isPaused = false; // Flag to track if we're in pause mode
let pauseEndTime = 0; // When the pause should end
const PAUSE_DURATION_MS = 10000; // 10 seconds pause after all attacks are launched
const ATTACKS = ["DDoS", "Brute Force", "SQL Injection", "Port Scan"];
const THREAT_LEVELS = [
  { level: "Low", weight: 50, color: "#00C853" },
  { level: "Medium", weight: 30, color: "#FFEB3B" },
  { level: "High", weight: 15, color: "#FF9800" },
  { level: "Critical", weight: 5, color: "#D50000" },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function pickWeighted(arr) {
  const total = arr.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const item of arr) {
    if (r < item.weight) return item;
    r -= item.weight;
  }
  return arr[arr.length - 1];
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function interpolateLatLng(a, b, f) {
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

// event generator — compute attack duration from the start
function genEvent() {
  // If we have historical attacks, replay them instead of generating random ones
  if (HISTORICAL_ATTACKS.length > 0) {
    // Check if we've gone through all attacks and are in pause mode
    if (attackIndex >= HISTORICAL_ATTACKS.length) {
      if (!isPaused) {
        console.log(`⏸️ All historical attacks launched. Starting ${PAUSE_DURATION_MS / 1000}s pause...`);
        isPaused = true;
        pauseEndTime = Date.now() + PAUSE_DURATION_MS;
      } else if (Date.now() >= pauseEndTime) {
        // Pause is over, reset to replay from beginning
        console.log("▶️ Pause ended. Restarting historical attack replay...");
        attackIndex = 0;
        isPaused = false;
      }
      return null; // Don't generate attack during pause
    }

    const historicalAttack = HISTORICAL_ATTACKS[attackIndex];
    attackIndex++;

    // Find matching source and target from loaded locations
    const source = LOCATIONS.find(
      (loc) => loc.ip === historicalAttack.source.ip
    ) || {
      id: `${historicalAttack.source.city || "Unknown"} (${
        historicalAttack.source.ip
      })`,
      lat: historicalAttack.source.lat,
      lng: historicalAttack.source.lng,
      ip: historicalAttack.source.ip,
      city: historicalAttack.source.city,
      country: historicalAttack.source.country,
    };

    const target = CENTERS.find(
      (center) => center.ip === historicalAttack.target.ip
    ) || {
      id: `${historicalAttack.target.city || "Unknown"} Server (${
        historicalAttack.target.ip
      })`,
      lat: historicalAttack.target.lat,
      lng: historicalAttack.target.lng,
      ip: historicalAttack.target.ip,
      city: historicalAttack.target.city,
      country: historicalAttack.target.country,
    };

    const totalDistance = haversine(
      source.lat,
      source.lng,
      target.lat,
      target.lng
    );
    const attackTravelTimeMs = Math.min(
      (totalDistance / ATTACK_SPEED_MPS) * 1000,
      8000
    ); // Maksimal 8 detik untuk visualisasi yang lebih cepat

    return {
      id: uuidv4(),
      attackType: historicalAttack.attackType,
      source,
      target,
      threatLevel: historicalAttack.threatLevel,
      color: getThreatColor(historicalAttack.threatLevel),
      totalDistance,
      attackTravelTimeMs,
      timestamp: Date.now(),
      historicalId: historicalAttack.id,
      signature: historicalAttack.signature,
      category: historicalAttack.category,
    };
  }

  // Fallback to random generation if no historical attacks
  const src = pick(LOCATIONS);
  const threat = pickWeighted(THREAT_LEVELS);
  const target = pick(CENTERS);
  const attackType = pick(ATTACKS);

  const totalDistance = haversine(src.lat, src.lng, target.lat, target.lng);
  const attackTravelTimeMs = (totalDistance / ATTACK_SPEED_MPS) * 1000;

  return {
    id: uuidv4(),
    attackType,
    source: src,
    target,
    threatLevel: threat.level,
    color: threat.color,
    totalDistance,
    attackTravelTimeMs,
    timestamp: Date.now(),
  };
}

// Helper function to get color based on threat level
function getThreatColor(threatLevel) {
  const level = THREAT_LEVELS.find((t) => t.level === threatLevel);
  return level ? level.color : "#FF9800"; // Default to orange
}

// ---------------- Simulation management ----------------
const activeSims = new Map(); // id -> { attackTimer, attackMeta }

function startSimulationForAttack(ev) {
  if (activeSims.has(ev.id)) return;
  const attackStart = Date.now();
  const attackMeta = {
    id: ev.id,
    source: ev.source,
    target: ev.target,
    attackTravelTimeMs: ev.attackTravelTimeMs,
    startTime: attackStart,
  };

  const attackTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = now - attackMeta.startTime;
    const frac = Math.min(1, elapsed / attackMeta.attackTravelTimeMs);
    const pos = interpolateLatLng(attackMeta.source, attackMeta.target, frac);

    io.emit("attack-update", {
      id: attackMeta.id,
      frac,
      pos,
      elapsed,
      attackTravelTimeMs: attackMeta.attackTravelTimeMs,
    });

    if (frac >= 1) {
      io.emit("attack-final", {
        id: attackMeta.id,
        result: "hit",
        pos: attackMeta.target,
      });
      clearInterval(attackTimer);
      activeSims.delete(attackMeta.id);
    }
  }, SIM_STEP_MS);

  activeSims.set(ev.id, { attackTimer, attackMeta });
}

// Load attack locations and centers from database on server start
async function initializeLocations() {
  try {
    console.log("📍 Loading attack locations from attacker table...");

    // Load attacker data from database
    const { Client } = require('pg');
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    await client.connect();

    // Get attacker data
    const attackerResult = await client.query(`
      SELECT source_ip, dstip, agent_name, lon, lat, time
      FROM attacker
      ORDER BY time DESC
    `);

    console.log(`📊 Found ${attackerResult.rows.length} attacker records`);

    // Extract unique source locations from attacker table
    const uniqueSources = new Map();

    attackerResult.rows.forEach((row) => {
      const key = `${row.source_ip}-${row.lon}-${row.lat}`;
      if (!uniqueSources.has(key)) {
        uniqueSources.set(key, {
          id: `${row.source_ip} (${row.agent_name})`,
          lat: parseFloat(row.lat),
          lng: parseFloat(row.lon),
          ip: row.source_ip,
          city: 'Unknown', // We don't have city data in attacker table
          country: 'Unknown', // We don't have country data in attacker table
          agent_name: row.agent_name,
        });
      }
    });

    LOCATIONS = Array.from(uniqueSources.values());
    console.log(
      `✅ Loaded ${LOCATIONS.length} unique attack source locations from attacker table`
    );

    // Debug: Show loaded locations
    LOCATIONS.forEach((loc, i) => {
      console.log(`${i + 1}. ${loc.id} [${loc.lat}, ${loc.lng}]`);
    });

    // Set manual centers (target servers)
    CENTERS = [
      {
        id: "Server Jakarta",
        lat: -6.177463257461286,
        lng: 106.83199928943905,
        ip: "10.90.24.100", // Example IP
        city: "Jakarta",
        country: "Indonesia",
        attack_count: attackerResult.rows.length
      },
      {
        id: "Server Singapore",
        lat: 1.327532426561102,
        lng: 103.84461791330435,
        ip: "10.90.66.100", // Example IP
        city: "Singapore",
        country: "Singapore",
        attack_count: Math.floor(attackerResult.rows.length / 2)
      }
    ];

    console.log(`✅ Set ${CENTERS.length} manual center locations`);

    // Debug: Show loaded centers
    CENTERS.forEach((center, i) => {
      console.log(
        `${i + 1}. ${center.id} [${center.lat}, ${center.lng}]`
      );
    });

    // Create historical attacks from attacker table data
    HISTORICAL_ATTACKS = attackerResult.rows.map((row, index) => ({
      id: `attack-${index}`,
      attackType: 'Cyber Attack',
      source: {
        ip: row.source_ip,
        country: 'Unknown',
        city: 'Unknown',
        lat: parseFloat(row.lat),
        lng: parseFloat(row.lon)
      },
      target: CENTERS[0], // Default to first center
      threatLevel: 'Medium',
      timestamp: row.time,
      signature: row.agent_name,
      category: 'Unknown'
    }));

    // Sort historical attacks by timestamp in ascending order (oldest first)
    HISTORICAL_ATTACKS.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    console.log(
      `✅ Created and sorted ${HISTORICAL_ATTACKS.length} historical attacks from attacker table`
    );

    // Debug: Show loaded historical attacks
    HISTORICAL_ATTACKS.slice(0, 5).forEach((attack, i) => {
      console.log(
        `${i + 1}. ${attack.attackType} from ${attack.source.ip} to ${
          attack.target.id
        } (${attack.threatLevel})`
      );
    });

    await client.end();

  } catch (error) {
    console.error("❌ Failed to load locations from database:", error.message);
    // Fallback to default locations
    LOCATIONS = [
      { id: "Jakarta (10.90.24.*)", lat: -6.2088, lng: 106.8456 },
      { id: "Surabaya (10.90.66.*)", lat: -7.2575, lng: 112.7521 },
    ];
    CENTERS = [
      {
        id: "Server Jakarta",
        lat: -6.177463257461286,
        lng: 106.83199928943905,
      },
      {
        id: "Server Singapore",
        lat: 1.327532426561102,
        lng: 103.84461791330435,
      },
      { id: "Server Tokyo", lat: 35.6762, lng: 139.6503 },
    ];
    HISTORICAL_ATTACKS = [];
    console.log("⚠️ Using fallback locations and centers");
  }
}

// ---------------- socket handlers ----------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.emit("center-info", { centers: CENTERS });
  socket.emit("server-status", {
    ok: true,
    message: "Threat Map simulation server online",
  });
});

// emit loop -> generate attacks
setInterval(() => {
  const ev = genEvent();

  if (ev) { // Only emit if we have an attack event (not during pause)
    io.emit("attack-event", ev);
    console.log(
      `🚀 New attack: ${ev.attackType} ${ev.source.id} → ${ev.target.id}`
    );

    // Start attack simulation - no interceptors, just threat map
    startSimulationForAttack(ev);

    console.log(`⚡ Attack simulation started - threat map mode`);
  }
}, UPDATE_INTERVAL);

app.get("/centers", (req, res) => res.json({ centers: CENTERS }));

// Initialize locations on server start
initializeLocations()
  .then(() => {
    srv.listen(PORT, () =>
      console.log(`Threat Map simulation server running on :${PORT}`)
    );
  })
  .catch((error) => {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  });
