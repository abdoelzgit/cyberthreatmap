// socket-server-irondome-improved.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { getAttackLocationsWithGeo, getCentersFromDatabase, getHistoricalAttacks } = require("./ip-geolocation");

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: "*" } });
const PORT = 4000;

// CONFIG
const EARTH_RADIUS = 6371000;
const DETECTION_RADIUS = 6_000_000; // 6000 km (zone detection radius)
const ATTACK_SPEED_MPS = 800; // incoming missile speed (m/s)
const INTERCEPTOR_SPEED_MPS = 1200; // interceptor speed (m/s)
const UPDATE_INTERVAL = 10000; // ms — event generation interval
const SIM_STEP_MS = 100; // ms — interval untuk update simulasi posisi (10 updates/detik untuk smooth animation)
const PATH_SAMPLES = 80; // jumlah sample titik di lintasan untuk cek proximity

// Dynamic locations from database geolocation
let LOCATIONS = [];
let CENTERS = []; // Will be loaded from database
let HISTORICAL_ATTACKS = []; // Will be loaded from database
let attackIndex = 0; // Index for replaying historical attacks
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
    const historicalAttack = HISTORICAL_ATTACKS[attackIndex % HISTORICAL_ATTACKS.length];
    attackIndex++;

    // Find matching source and target from loaded locations
    const source = LOCATIONS.find(loc => loc.ip === historicalAttack.source.ip) || {
      id: `${historicalAttack.source.city || 'Unknown'} (${historicalAttack.source.ip})`,
      lat: historicalAttack.source.lat,
      lng: historicalAttack.source.lng,
      ip: historicalAttack.source.ip,
      city: historicalAttack.source.city,
      country: historicalAttack.source.country
    };

    const target = CENTERS.find(center => center.ip === historicalAttack.target.ip) || {
      id: `${historicalAttack.target.city || 'Unknown'} Server (${historicalAttack.target.ip})`,
      lat: historicalAttack.target.lat,
      lng: historicalAttack.target.lng,
      ip: historicalAttack.target.ip,
      city: historicalAttack.target.city,
      country: historicalAttack.target.country
    };

    const totalDistance = haversine(source.lat, source.lng, target.lat, target.lng);
    const attackTravelTimeMs = (totalDistance / ATTACK_SPEED_MPS) * 1000;

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
      category: historicalAttack.category
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
  const level = THREAT_LEVELS.find(t => t.level === threatLevel);
  return level ? level.color : "#FF9800"; // Default to orange
}

// cek apakah lintasan source->target melewati dekat center
function pathPassesNear(
  center,
  source,
  target,
  samples = PATH_SAMPLES,
  radius = DETECTION_RADIUS
) {
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const p = interpolateLatLng(source, target, f);
    const d = haversine(center.lat, center.lng, p.lat, p.lng);
    if (d <= radius)
      return { passes: true, fraction: f, samplePoint: p, distance: d };
  }
  return { passes: false };
}

// ---------------- Simulation management ----------------
const activeSims = new Map(); // id -> { attackTimer, defenses:[], attackMeta }

function startSimulationForAttack(ev) {
  if (activeSims.has(ev.id)) return;
  const attackStart = Date.now();
  const attackMeta = {
    id: ev.id,
    source: ev.source,
    target: ev.target,
    attackTravelTimeMs: ev.attackTravelTimeMs,
    startTime: attackStart,
    launchedCenters: new Set(), // track centers that have launched interceptors
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

    // REMOVED: Multi-center detection logic - only target center launches interceptors now

    if (frac >= 1) {
      io.emit("attack-final", {
        id: attackMeta.id,
        result: "hit",
        pos: attackMeta.target,
      });
      clearInterval(attackTimer);
      const entry = activeSims.get(attackMeta.id);
      if (entry) entry.attackTimer = null;
      // schedule cleanup if no defenses (defenses will cleanup themselves)
      setTimeout(() => {
        const e = activeSims.get(attackMeta.id);
        if (
          e &&
          (!e.attackTimer || e.attackTimer === null) &&
          e.defenses.length === 0
        ) {
          activeSims.delete(attackMeta.id);
        }
      }, 1000); // Reduced cleanup delay from 5s to 1s for better memory management
    }
  }, SIM_STEP_MS);

  activeSims.set(ev.id, { attackTimer, defenses: [], attackMeta });
}

// simulasi interceptor untuk satu center mengejar rudal
function launchInterceptor(ev, center) {
  const simId = `${ev.id}::${center.id}::${uuidv4()}`;
  const now = Date.now();
  const distCenterToSource = haversine(
    center.lat,
    center.lng,
    ev.source.lat,
    ev.source.lng
  );
  const interceptorTimeMs = (distCenterToSource / INTERCEPTOR_SPEED_MPS) * 1000;
  const interceptorMeta = {
    simId,
    attackId: ev.id,
    center,
    threatStart: ev.source,
    distCenterToSource,
    interceptorTimeMs,
    launchTime: now,
    timer: null,
  };

  if (!activeSims.has(ev.id)) startSimulationForAttack(ev);
  const s = activeSims.get(ev.id);
  s.defenses.push(interceptorMeta);

  const defensePayload = {
    simId: interceptorMeta.simId,
    id: ev.id,
    center: { lat: center.lat, lng: center.lng, id: center.id },
    threat: { lat: ev.source.lat, lng: ev.source.lng, id: ev.source.id },
    interceptorTimeMs,
    attackTimeMs: ev.attackTravelTimeMs,
    launchTime: interceptorMeta.launchTime,
    color: "#00FFFF",
  };
  io.emit("defense-launch", defensePayload);

  const start = interceptorMeta.launchTime;
  const turretTimer = setInterval(() => {
    const now2 = Date.now();
    const elapsed = now2 - start;
    const fracIntercept = Math.min(
      1,
      interceptorTimeMs === 0 ? 1 : elapsed / interceptorTimeMs
    );
    const posInterceptor = interpolateLatLng(center, ev.source, fracIntercept);

    const attackEntry = activeSims.get(ev.id);
    const attackElapsed = now2 - attackEntry.attackMeta.startTime;
    const missileFrac = Math.min(
      1,
      attackElapsed / attackEntry.attackMeta.attackTravelTimeMs
    );
    const posMissile = interpolateLatLng(ev.source, ev.target, missileFrac);

    io.emit("defense-update", {
      simId: interceptorMeta.simId,
      attackId: ev.id,
      fracIntercept,
      posInterceptor,
      elapsed,
      interceptorTimeMs,
      missileFrac,
      posMissile,
    });

    // Calculate distance between interceptor and missile
    const distance = haversine(
      posInterceptor.lat,
      posInterceptor.lng,
      posMissile.lat,
      posMissile.lng
    );

    // Optimized collision detection - check every 500ms instead of every 100ms
    if (elapsed % 500 === 0) {
      // success: interceptor arrives source while missile belum hit target
      if (fracIntercept >= 1 && missileFrac < 1) {
        console.log(`✅ ${interceptorMeta.simId}: Interceptor reached source before missile hit target`);
        io.emit("intercept-result", {
          simId: interceptorMeta.simId,
          attackId: ev.id,
          intercepted: true,
          interceptAt: posInterceptor,
          times: { interceptorElapsed: elapsed, missileElapsed: attackElapsed },
        });
        clearInterval(turretTimer);
        cleanupDefense(ev.id, interceptorMeta.simId);
      }

      // failed: missile hit target before interceptor arrives
      if (missileFrac >= 1 && fracIntercept < 1) {
        console.log(`❌ ${interceptorMeta.simId}: Missile hit target before interceptor arrived`);
        io.emit("intercept-result", {
          simId: interceptorMeta.simId,
          attackId: ev.id,
          intercepted: false,
          reason: "missile_hit_target",
          interceptorPos: posInterceptor,
          missilePos: ev.target,
          times: { interceptorElapsed: elapsed, missileElapsed: attackElapsed },
        });
        clearInterval(turretTimer);
        cleanupDefense(ev.id, interceptorMeta.simId);
      }

      // tie case
      if (fracIntercept >= 1 && missileFrac >= 1) {
        const intercepted = elapsed <= attackElapsed;
        console.log(`🤝 ${interceptorMeta.simId}: Tie case - Intercepted: ${intercepted} (elapsed: ${elapsed}ms vs ${attackElapsed}ms)`);
        io.emit("intercept-result", {
          simId: interceptorMeta.simId,
          attackId: ev.id,
          intercepted,
          interceptAt: posInterceptor,
          times: { interceptorElapsed: elapsed, missileElapsed: attackElapsed },
        });
        clearInterval(turretTimer);
        cleanupDefense(ev.id, interceptorMeta.simId);
      }

      // Collision check: if interceptor and missile are very close (< 10km for realistic interception)
      if (distance < 10000 && fracIntercept > 0.1) { // interceptor sudah launch minimal 10%
        console.log(`💥 ${interceptorMeta.simId}: COLLISION DETECTED! Distance: ${Math.round(distance)}m`);
        io.emit("intercept-result", {
          simId: interceptorMeta.simId,
          attackId: ev.id,
          intercepted: true,
          interceptAt: posInterceptor,
          collisionDistance: distance,
          times: { interceptorElapsed: elapsed, missileElapsed: attackElapsed },
        });
        clearInterval(turretTimer);
        cleanupDefense(ev.id, interceptorMeta.simId);
      }
    }
  }, SIM_STEP_MS);

  interceptorMeta.timer = turretTimer;
}

function cleanupDefense(attackId, simId) {
  const entry = activeSims.get(attackId);
  if (!entry) return;
  entry.defenses = entry.defenses.filter((d) => {
    if (d.simId === simId) {
      if (d.timer) clearInterval(d.timer);
      return false;
    }
    return true;
  });

  // if attack timer is gone and no defenses left, remove entry
  if (
    (!entry.attackTimer || entry.attackTimer === null) &&
    entry.defenses.length === 0
  ) {
    activeSims.delete(attackId);
  }
}

// Load attack locations and centers from database on server start
async function initializeLocations() {
  try {
    console.log('📍 Loading attack locations from database...');
    const attackRoutes = await getAttackLocationsWithGeo();

    // Extract unique source locations from attack routes
    const uniqueSources = new Map();

    attackRoutes.forEach(route => {
      const source = route.source;
      const key = `${source.ip}-${source.lat}-${source.lng}`;
      if (!uniqueSources.has(key)) {
        uniqueSources.set(key, {
          id: `${source.city || 'Unknown'} (${source.ip})`,
          lat: parseFloat(source.lat),
          lng: parseFloat(source.lng),
          ip: source.ip,
          city: source.city,
          country: source.country,
          alert_count: route.alertCount
        });
      }
    });

    LOCATIONS = Array.from(uniqueSources.values());
    console.log(`✅ Loaded ${LOCATIONS.length} unique attack source locations from database`);

    // Debug: Show loaded locations
    LOCATIONS.forEach((loc, i) => {
      console.log(`${i+1}. ${loc.id} [${loc.lat}, ${loc.lng}]`);
    });

    // Load centers from database
    console.log('🏢 Loading centers from database...');
    CENTERS = await getCentersFromDatabase();
    console.log(`✅ Loaded ${CENTERS.length} centers from database`);

    // Debug: Show loaded centers
    CENTERS.forEach((center, i) => {
      console.log(`${i+1}. ${center.id} [${center.lat}, ${center.lng}] - ${center.attack_count} attacks`);
    });

    // Load historical attacks from database
    console.log('📜 Loading historical attacks from database...');
    HISTORICAL_ATTACKS = await getHistoricalAttacks(100); // Load last 100 attacks
    console.log(`✅ Loaded ${HISTORICAL_ATTACKS.length} historical attacks from database`);

    // Debug: Show loaded historical attacks
    HISTORICAL_ATTACKS.slice(0, 5).forEach((attack, i) => {
      console.log(`${i+1}. ${attack.attackType} from ${attack.source.city} to ${attack.target.city} (${attack.threatLevel})`);
    });

  } catch (error) {
    console.error('❌ Failed to load locations from database:', error.message);
    // Fallback to default locations
    LOCATIONS = [
      { id: "Jakarta (10.90.24.*)", lat: -6.2088, lng: 106.8456 },
      { id: "Surabaya (10.90.66.*)", lat: -7.2575, lng: 112.7521 },
    ];
    CENTERS = [
      { id: "Server Jakarta", lat: -6.177463257461286, lng: 106.83199928943905 },
      { id: "Server Singapore", lat: 1.327532426561102, lng: 103.84461791330435 },
      { id: "Server Tokyo", lat: 35.6762, lng: 139.6503 },
    ];
    HISTORICAL_ATTACKS = [];
    console.log('⚠️ Using fallback locations and centers');
  }
}

// ---------------- socket handlers ----------------
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.emit("center-info", { centers: CENTERS });
  socket.emit("server-status", {
    ok: true,
    message: "Iron Dome improved simulation server online",
  });
});

// emit loop -> generate attacks
setInterval(() => {
  const ev = genEvent();

  io.emit("attack-event", ev);
  console.log(
    `🚀 New attack: ${ev.attackType} ${ev.source.id} → ${ev.target.id}`
  );

  // Start attack simulation for all attacks
  startSimulationForAttack(ev);

  // DELAYED LAUNCH LOGIC: Calculate delay based on distance
  const targetCenter = CENTERS.find(c => c.id === ev.target.id);
  if (targetCenter) {
    const distanceToTarget = haversine(
      ev.source.lat, ev.source.lng,
      targetCenter.lat, targetCenter.lng
    );

    console.log(`📏 Distance to target: ${Math.round(distanceToTarget/1000)}km`);

    if (distanceToTarget > 10000 * 1000) { // > 10000km
      // Calculate delay to launch interceptor when missile is near target
      // Launch when missile has traveled 80% of the distance (near target area)
      const delayMs = (ev.attackTravelTimeMs * 0.8);
      console.log(`⏰ Long-range attack detected - Delaying interceptor launch by ${Math.round(delayMs/1000)}s`);

      setTimeout(() => {
        console.log(`🚀 DELAYED LAUNCH: Interceptor launching for ${ev.id} at target area`);
        launchInterceptor(ev, targetCenter);
        if (activeSims.has(ev.id)) {
          activeSims.get(ev.id).attackMeta.launchedCenters.add(targetCenter.id);
        }
      }, delayMs);
    } else {
      // Short-range attack: launch immediately
      console.log(`⚡ Short-range attack - Launching interceptor immediately`);
      launchInterceptor(ev, targetCenter);
      activeSims.get(ev.id).attackMeta.launchedCenters.add(targetCenter.id);
    }
  }

  console.log(`⚡ Attack simulation started - interceptor will launch based on distance logic`);
}, UPDATE_INTERVAL);

app.get("/centers", (req, res) => res.json({ centers: CENTERS }));

// Initialize locations on server start
initializeLocations().then(() => {
  srv.listen(PORT, () =>
    console.log(`Iron Dome improved simulation server running on :${PORT}`)
  );
}).catch((error) => {
  console.error('Failed to initialize server:', error);
  process.exit(1);
});
