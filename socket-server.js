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
const DETECTION_RADIUS = 1_500_000; // 1500 km
const INTERCEPT_DISTANCE = 100_000; // intercept ~100 km from target
const ATTACK_SPEED_MPS = 800; // incoming missile speed (m/s)
const INTERCEPTOR_SPEED_MPS = 1200; // interceptor speed (m/s)
const UPDATE_INTERVAL = 10000; // ms

// sample locations & centers
const LOCATIONS = [
  { id: "Jakarta", lat: -6.2088, lng: 106.8456 },
  { id: "Singapore", lat: 1.3521, lng: 103.8198 },
  { id: "Tokyo", lat: 35.6762, lng: 139.6503 },
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

function toRad(deg) { return (deg * Math.PI) / 180; }
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function interpolateLatLng(a, b, f) {
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

// compute an intercept point measured `interceptDist` from the target along the incoming path
function computeInterceptPoint(source, target, interceptDist) {
  const totalDist = haversine(source.lat, source.lng, target.lat, target.lng);
  if (totalDist <= interceptDist) return source;
  const frac = (totalDist - interceptDist) / totalDist;
  return interpolateLatLng(source, target, frac);
}

// event generator — improved: compute attack duration and intercept timings from the start
function genEvent() {
  const src = pick(LOCATIONS);
  const threat = pickWeighted(THREAT_LEVELS);
  const target = pick(CENTERS);
  const attackType = pick(ATTACKS);

  const totalDistance = haversine(src.lat, src.lng, target.lat, target.lng);
  const attackTravelTimeMs = (totalDistance / ATTACK_SPEED_MPS) * 1000;

  // compute intercept point from start (don't wait until missile enters detection zone)
  const interceptPoint = computeInterceptPoint(src, target, INTERCEPT_DISTANCE);
  const distAttackToIntercept = haversine(src.lat, src.lng, interceptPoint.lat, interceptPoint.lng);
  const distCenterToIntercept = haversine(target.lat, target.lng, interceptPoint.lat, interceptPoint.lng);

  const attackTimeToInterceptMs = (distAttackToIntercept / ATTACK_SPEED_MPS) * 1000;
  const interceptorTimeMs = (distCenterToIntercept / INTERCEPTOR_SPEED_MPS) * 1000;

  // We want interceptor to arrive <= attack arrival; schedule interceptor launch so its time matches
  // launchDelayMs = attackTimeToInterceptMs - interceptorTimeMs
  const launchDelayMs = Math.max(0, Math.round(attackTimeToInterceptMs - interceptorTimeMs));

  const intercepted = interceptorTimeMs <= attackTimeToInterceptMs;

  return {
    id: uuidv4(),
    attackType,
    source: src,
    target,
    threatLevel: threat.level,
    color: threat.color,
    totalDistance,
    attackTravelTimeMs,
    intercepted,
    interceptPoint,
    attackTimeToInterceptMs,
    interceptorTimeMs,
    interceptorLaunchDelayMs: launchDelayMs,
    timestamp: Date.now(),
  };
}

// socket handlers
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.emit("center-info", { centers: CENTERS });
  socket.emit("server-status", { ok: true, message: "Iron Dome improved server online" });
});

// emit loop
setInterval(() => {
  const ev = genEvent();

  // emit attack with computed timings — client will animate using these durations
  io.emit("attack-event", ev);

  // if intercepted, emit defense-launch immediately but include delay so client schedules the visual launch
  if (ev.intercepted) {
    const defensePayload = {
      id: ev.id,
      center: { lat: ev.target.lat, lng: ev.target.lng, id: ev.target.id },
      threat: { lat: ev.interceptPoint.lat, lng: ev.interceptPoint.lng },
      delay: ev.interceptorLaunchDelayMs,
      interceptorTimeMs: ev.interceptorTimeMs,
      attackTimeToInterceptMs: ev.attackTimeToInterceptMs,
      color: "#00FFFF",
    };
    io.emit("defense-launch", defensePayload);
    console.log(`Intercept planned in ${Math.round(ev.attackTimeToInterceptMs/1000)}s, defense launch delay ${Math.round(defensePayload.delay/1000)}s`);
  } else {
    console.log("No intercept possible — missile hits target.");
  }

  console.log(`${ev.attackType} ${ev.source.id} → ${ev.target.id}, intercepted: ${ev.intercepted}`);
}, UPDATE_INTERVAL);

app.get("/centers", (req, res) => res.json({ centers: CENTERS }));

srv.listen(PORT, () => console.log(`Iron Dome improved server running on :${PORT}`));
