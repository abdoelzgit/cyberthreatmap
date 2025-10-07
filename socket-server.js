// socket-server-multi-target-reflect.js
const Cesium = require("cesium");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: "*" } });
const PORT = 4000;

// =====================
// Lokasi Dunia (source & target)
// =====================
const LOCATIONS = [
  { id: "Jakarta", lat: -6.2088, lng: 106.8456 },
  { id: "Singapore", lat: 1.3521, lng: 103.8198 },
  { id: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { id: "Seoul", lat: 37.5665, lng: 126.978 },
  { id: "Sydney", lat: -33.8688, lng: 151.2093 },
  { id: "Paris", lat: 48.8566, lng: 2.3522 },
  { id: "New York", lat: 40.7128, lng: -74.006 },
  { id: "London", lat: 51.5074, lng: -0.1278 },
  { id: "Dubai", lat: 25.2048, lng: 55.2708 },
  { id: "Moscow", lat: 55.7558, lng: 37.6173 },
];

// =====================
// Target utama (pusat server)
// =====================
const CENTER = [
  { id: "Server 1", lat: -6.177463257461286, lng: 106.83199928943905 },
  { id: "Server 2", lat: 1.327532426561102, lng: 103.84461791330435 },
  { id: "Server 3", lat: 40.74657040942134, lng: 140.7196919470483 },
];

// =====================
// Barrier pertahanan
// =====================
const BARRIERS = [
  {
    id: "B-S1",
    lat: -6.177463257461286,
    lng: 106.83199928943905,
    radiusMeters: 30000,
  },
  {
    id: "B-S2",
    lat: 1.327532426561102,
    lng: 103.84461791330435,
    radiusMeters: 25000,
  },
  {
    id: "B-S3",
    lat: 40.74657040942134,
    lng: 140.7196919470483,
    radiusMeters: 20000,
  },
];

const ATTACKS = ["DDoS", "Brute Force", "SQL Injection", "Port Scan"];
const THREAT_LEVELS = [
  { level: "Low", weight: 50, color: "#00C853" },
  { level: "Medium", weight: 30, color: "#FFEB3B" },
  { level: "High", weight: 15, color: "#FF9800" },
  { level: "Critical", weight: 5, color: "#D50000" },
];

// =====================
// Fungsi Utilitas
// =====================
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

function pickNUnique(arr, n) {
  const copy = [...arr];
  const res = [];
  for (let i = 0; i < n && copy.length; i++) {
    res.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return res;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function interpolateLatLng(a, b, f) {
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
  };
}

function pathIntersectBarrier(source, target, barrier, samples = 64) {
  for (let i = 0; i <= samples; i++) {
    const frac = i / samples;
    const p = interpolateLatLng(source, target, frac);
    const d = haversineDistance(p.lat, p.lng, barrier.lat, barrier.lng);
    if (d <= barrier.radiusMeters) {
      return { hit: true, fraction: frac, point: p, distance: d };
    }
  }
  return null;
}

function randomDeflect(point, distanceKm = 400) {
  const bearing = Math.random() * 360;
  const R = 6371;
  const d = distanceKm / R;
  const lat1 = toRad(point.lat);
  const lon1 = toRad(point.lng);
  const brng = toRad(bearing);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: toDeg(lat2), lng: toDeg(lon2) };
}

function targetsCountForLevel(level) {
  switch (level) {
    case "Critical":
      return 3;
    case "High":
      return 2;
    case "Medium":
      return 1;
    default:
      return 1;
  }
}

// =====================
// Fungsi buat event serangan
// =====================
function genEvent() {
  const src = pick(LOCATIONS);
  const threat = pickWeighted(THREAT_LEVELS);
  const isCritical = threat.level === "Critical";

  const baseStrength = Math.floor(Math.random() * 50) + 10;
  const strengthBoost =
    threat.level === "Critical"
      ? 40
      : threat.level === "High"
      ? 20
      : threat.level === "Medium"
      ? 8
      : 0;
  const totalStrength = Math.min(100, baseStrength + strengthBoost);

  const nTargets = targetsCountForLevel(threat.level);
  const chosen = pickNUnique(CENTER, nTargets);

  const targets = chosen.map((t) => {
    let blocked = false;
    let blockedBy = null;
    let blockedPoint = null;
    let deflectPoint = null;
    if (!isCritical) {
      for (const b of BARRIERS) {
        const res = pathIntersectBarrier(src, t, b, 64);
        if (res && res.hit) {
          blocked = true;
          blockedBy = b.id;
          blockedPoint = res.point;
          deflectPoint = randomDeflect(res.point, 400);
          break;
        }
      }
    }
    return { ...t, blocked, blockedBy, blockedPoint, deflectPoint };
  });

  return {
    id: uuidv4(),
    attackType: pick(ATTACKS),
    source: src,
    targets,
    timestamp: Date.now(),
    threatLevel: threat.level,
    color: threat.color,
    totalStrength,
  };
}

// =====================
// Socket.io Server
// =====================
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Kirim data awal: titik target dan barrier
  socket.emit("center-info", {
    centers: CENTER,
    barriers: BARRIERS,
    message: "initial centers & barriers info",
  });

  // Kirim konfirmasi
  socket.emit("server-status", {
    ok: true,
    message: "Connected to multi-target reflect server",
  });
});

// =====================
// Emit event serangan setiap 10 detik
// =====================
const EMIT_INTERVAL_MS = 10000;

setInterval(() => {
  const ev = genEvent();
  io.emit("attack-event", ev);

  const blockedList = ev.targets.filter((t) => t.blocked).map((t) => t.id);
  const passedList = ev.targets.filter((t) => !t.blocked).map((t) => t.id);

  console.log(
    `[Emit] ${new Date(ev.timestamp).toISOString()} - ${ev.source.id} -> ${ev.targets
      .map((t) => t.id)
      .join(", ")} (${ev.attackType}) [${ev.threatLevel}]`
  );
  if (blockedList.length) console.log(`  🔒 Blocked: ${blockedList.join(", ")}`);
  if (passedList.length) console.log(`  ✅ Passed: ${passedList.join(", ")}`);
}, EMIT_INTERVAL_MS);

// =====================
// Endpoint tambahan (cek di browser)
// =====================
app.get("/centers", (req, res) => res.json({ centers: CENTER, barriers: BARRIERS }));

srv.listen(PORT, () =>
  console.log(`🚀 Socket server with deflect system running on :${PORT}`)
);
