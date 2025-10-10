// socket-server-irondome-improved.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: "*" } });
const PORT = 4000;

// CONFIG
const EARTH_RADIUS = 6371000;
const DETECTION_RADIUS = 1_500_000; // 1500 km (zone detection radius)
const ATTACK_SPEED_MPS = 800; // incoming missile speed (m/s)
const INTERCEPTOR_SPEED_MPS = 1200; // interceptor speed (m/s)
const UPDATE_INTERVAL = 10000; // ms — event generation interval
const SIM_STEP_MS = 1000; // ms — interval untuk update simulasi posisi
const PATH_SAMPLES = 80; // jumlah sample titik di lintasan untuk cek proximity

// sample locations & centers
const LOCATIONS = [
  { id: "Seoul", lat: 37.5665, lng: 126.978 },
  { id: "Sydney", lat: -33.8688, lng: 151.2093 },
  { id: "Paris", lat: 48.8566, lng: 2.3522 },
  { id: "New York", lat: 40.7128, lng: -74.006 },
];
const CENTERS = [
  { id: "Server 1", lat: -6.177463257461286, lng: 106.83199928943905 },
  { id: "Server 2", lat: 1.327532426561102, lng: 103.84461791330435 },
  { id: "Server 3", lat: 40.74657040942134, lng: 140.7196919470483 },
];
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
      }, 5000);
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

    // success: interceptor arrives source while missile belum hit target
    if (fracIntercept >= 1 && missileFrac < 1) {
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

  // cek tiap center: apakah lintasan melewati radius deteksi center
  const detectingCenters = [];

  // Cari server target dari event serangan
  const targetCenter = CENTERS.find((c) => c.id === ev.target.id);

  if (targetCenter) {
    console.log(
      `🛡️ Target ${targetCenter.id} under attack — launching interceptor!`
    );
    launchInterceptor(ev, targetCenter);
  } else {
    console.log(`⚠️ Target ${ev.target.id} not found in CENTERS list.`);
  }

  if (detectingCenters.length === 0) {
    console.log(
      "❌ No center detected path — missile continues toward target."
    );
    startSimulationForAttack(ev);
  } else {
    console.log(
      `🛡️ ${detectingCenters.length} center(s) detected path — launching interceptors.`
    );
    startSimulationForAttack(ev);
    for (const d of detectingCenters) {
      launchInterceptor(ev, d.center);
      console.log(
        `   → Launched from ${d.center.id} (time to source ~ ${Math.round(
          d.interceptorTimeMs
        )} ms)`
      );
    }
  }
}, UPDATE_INTERVAL);

app.get("/centers", (req, res) => res.json({ centers: CENTERS }));

srv.listen(PORT, () =>
  console.log(`Iron Dome improved simulation server running on :${PORT}`)
);
