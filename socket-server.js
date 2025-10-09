// socket-server-simple-response.js
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

const ATTACKS = ["DDoS", "Brute Force", "SQL Injection", "Port Scan"];
const THREAT_LEVELS = [
  { level: "Low", color: "#FFEB3B" },
  { level: "Medium", color: "#FFEB3B" },
  { level: "High", color: "#FFEB3B" },
  { level: "Critical", color: "#FFEB3B" },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickNUnique(arr, n) {
  const copy = [...arr];
  const res = [];
  for (let i = 0; i < n && copy.length; i++) {
    res.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return res;
}

// =====================
// Fungsi buat event serangan
// =====================
function genEvent() {
  const src = pick(LOCATIONS);
  const threat = pick(THREAT_LEVELS);
  const nTargets = Math.floor(Math.random() * 3) + 1;
  const chosen = pickNUnique(CENTER, nTargets);

  const targets = chosen.map((t) => {
    const accepted = Math.random() > 0.5; // 50% chance diterima
    return {
      ...t,
      accepted,
      color: accepted ? "#00FF00" : "#FF0000", // hijau = diterima, merah = ditolak
    };
  });

  return {
    id: uuidv4(),
    attackType: pick(ATTACKS),
    source: src,
    targets,
    timestamp: Date.now(),
    threatLevel: threat.level,
    color: threat.color,
  };
}

// =====================
// Socket.io Server
// =====================
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("center-info", {
    centers: CENTER,
    message: "initial centers info (no barriers)",
  });

  socket.emit("server-status", {
    ok: true,
    message: "Connected to simple response server",
  });
});

// =====================
// Emit event serangan setiap 10 detik
// =====================
const EMIT_INTERVAL_MS = 10000;

setInterval(() => {
  const ev = genEvent();
  io.emit("attack-event", ev);

  const accepted = ev.targets.filter((t) => t.accepted).map((t) => t.id);
  const rejected = ev.targets.filter((t) => !t.accepted).map((t) => t.id);

  console.log(
    `[Emit] ${new Date(ev.timestamp).toISOString()} - ${ev.source.id} -> ${ev.targets
      .map((t) => t.id)
      .join(", ")} (${ev.attackType}) [${ev.threatLevel}]`
  );
  if (accepted.length) console.log(`  ✅ Passed: ${accepted.join(", ")}`);
  if (rejected.length) console.log(`  ❌ Rejected: ${rejected.join(", ")}`);
}, EMIT_INTERVAL_MS);

// =====================
// Endpoint tambahan (cek di browser)
// =====================
app.get("/centers", (req, res) => res.json({ centers: CENTER }));

srv.listen(PORT, () =>
  console.log(`🚀 Simple socket server running on :${PORT}`)
);
