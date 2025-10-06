// socket-server-multi-target-fixed.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: "*" } });

const PORT = 4000;

const LOCATIONS = [
  { id: "Jakarta", lat: -6.2088, lng: 106.8456 },
  { id: "Singapore", lat: 1.3521, lng: 103.8198 },
  { id: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { id: "Seoul", lat: 37.5665, lng: 126.978 },
  { id: "Sydney", lat: -33.8688, lng: 151.2093 },
  { id: "Paris", lat: 48.8566, lng: 2.3522 },
  { id: "New York", lat: 40.7128, lng: -74.006 },
  { id: "London", lat: 51.5074, lng: -0.1278 },
  { id: "Los Angeles", lat: 34.0522, lng: -118.2437 },
  { id: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { id: "Chicago", lat: 41.8781, lng: -87.6298 },
  { id: "Houston", lat: 29.7604, lng: -95.3698 },
  { id: "Toronto", lat: 43.65107, lng: -79.347015 },
  { id: "Vancouver", lat: 49.2827, lng: -123.1207 },
  { id: "Mexico City", lat: 19.4326, lng: -99.1332 },
  { id: "Sao Paulo", lat: -23.5505, lng: -46.6333 },
  { id: "Buenos Aires", lat: -34.6037, lng: -58.3816 },
  { id: "Lima", lat: -12.0464, lng: -77.0428 },
  { id: "Beijing", lat: 39.9042, lng: 116.4074 },
  { id: "Shanghai", lat: 31.2304, lng: 121.4737 },
  { id: "Hong Kong", lat: 22.3193, lng: 114.1694 },
  { id: "Bangkok", lat: 13.7563, lng: 100.5018 },
  { id: "Manila", lat: 14.5995, lng: 120.9842 },
  { id: "Kuala Lumpur", lat: 3.139, lng: 101.6869 },
  { id: "Mumbai", lat: 19.076, lng: 72.8777 },
  { id: "Delhi", lat: 28.7041, lng: 77.1025 },
  { id: "Karachi", lat: 24.8607, lng: 67.0011 },
  { id: "Dhaka", lat: 23.8103, lng: 90.4125 },
  { id: "Istanbul", lat: 41.0082, lng: 28.9784 },
  { id: "Moscow", lat: 55.7558, lng: 37.6173 },
  { id: "Dubai", lat: 25.2048, lng: 55.2708 },
  { id: "Riyadh", lat: 24.7136, lng: 46.6753 },
  { id: "Cape Town", lat: -33.9249, lng: 18.4241 },
  { id: "Johannesburg", lat: -26.2041, lng: 28.0473 },
  { id: "Nairobi", lat: -1.2921, lng: 36.8219 },
  { id: "Rome", lat: 41.9028, lng: 12.4964 },
  { id: "Berlin", lat: 52.52, lng: 13.405 },
  { id: "Madrid", lat: 40.4168, lng: -3.7038 },
  { id: "Barcelona", lat: 41.3851, lng: 2.1734 },
  { id: "Amsterdam", lat: 52.3676, lng: 4.9041 },
  { id: "Brussels", lat: 50.8503, lng: 4.3517 },
  { id: "Zurich", lat: 47.3769, lng: 8.5417 },
  { id: "Oslo", lat: 59.9139, lng: 10.7522 },
  { id: "Stockholm", lat: 59.3293, lng: 18.0686 },
  { id: "Tehran", lat: 35.6892, lng: 51.389 },
  { id: "Baghdad", lat: 33.3152, lng: 44.3661 },
  { id: "Auckland", lat: -36.8485, lng: 174.7633 },
  { id: "Honolulu", lat: 21.3069, lng: -157.8583 },
  { id: "Hanoi", lat: 21.0285, lng: 105.8542 },
  { id: "Casablanca", lat: 33.5731, lng: -7.5898 },
  { id: "Lisbon", lat: 38.7223, lng: -9.1393 },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ATTACKS = ["DDoS", "Brute Force", "SQL Injection", "Port Scan"];

const THREAT_LEVELS = [
  { level: "Low", weight: 50, color: "#00C853" }, // green
  { level: "Medium", weight: 30, color: "#FFEB3B" }, // yellow
  { level: "High", weight: 15, color: "#FF9800" }, // orange
  { level: "Critical", weight: 5, color: "#D50000" }, // red
];

function pickWeighted(arr) {
  const sum = arr.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * sum;
  for (const item of arr) {
    if (r < item.weight) return item;
    r -= item.weight;
  }
  return arr[arr.length - 1];
}

const CENTER = [
  { id: "Server 1", lat: -6.177463257461286, lng: 106.83199928943905 },
  { id: "Server 2", lat: 1.327532426561102, lng: 103.84461791330435 },
  { id: "Server 3", lat: 40.74657040942134, lng: 140.7196919470483 },
];

function pickNUnique(arr, n) {
  if (n >= arr.length) return arr.slice();
  const copy = arr.slice();
  const picked = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(idx, 1)[0]); // <-- splice, bukan slice
  }
  return picked;
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

function genEvent() {
  const src = pick(LOCATIONS);
  const threat = pickWeighted(THREAT_LEVELS);

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

  // safety: jika chosen.length === 0 (edge-case), fallback ke satu center
  const finalChosen = chosen.length > 0 ? chosen : [CENTER[0]];
  const per = Math.floor(totalStrength / finalChosen.length) || totalStrength;

  const targets = finalChosen.map((t) => ({ ...t, strength: per }));

  // legacy compatibility: target as first target (for older clients)
  const legacyTarget = targets[0];

  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    attackType: pick(ATTACKS),
    source: src,
    targets,
    target: legacyTarget, // <-- legacy single target for compatibility
    timestamp: Date.now(),
    threatLevel: threat.level,
    color: threat.color,
    totalStrength,
  };
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.emit("center-info", {
    centers: CENTER,
    message: "multi-target mode with threatLevel",
  });
});

const EMIT_INTERVAL_MS = 10000;

setInterval(() => {
  const ev = genEvent();
  io.emit("attack-event", ev);

  console.log(
    `[Emit] ${new Date(ev.timestamp).toISOString()} - ${ev.source.id} -> ${ev.targets
      .map((t) => t.id)
      .join(", ")} (${ev.attackType}) - ${ev.threatLevel}`
  );
}, EMIT_INTERVAL_MS);

srv.listen(PORT, () => console.log(`Socket server on :${PORT}`));
