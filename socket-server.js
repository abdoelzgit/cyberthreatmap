// socket-server-single-target.js
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
  { id: "Seoul", lat: 37.5665, lng: 126.9780 },
  { id: "Sydney", lat: -33.8688, lng: 151.2093 },
  { id: "Paris", lat: 48.8566, lng: 2.3522 },
  { id: "New York", lat: 40.7128, lng: -74.0060 },
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
  { id: "Kuala Lumpur", lat: 3.1390, lng: 101.6869 },
  { id: "Mumbai", lat: 19.0760, lng: 72.8777 },
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
  { id: "Berlin", lat: 52.5200, lng: 13.4050 },
  { id: "Madrid", lat: 40.4168, lng: -3.7038 },
  { id: "Barcelona", lat: 41.3851, lng: 2.1734 },
  { id: "Amsterdam", lat: 52.3676, lng: 4.9041 },
  { id: "Brussels", lat: 50.8503, lng: 4.3517 },
  { id: "Zurich", lat: 47.3769, lng: 8.5417 },
  { id: "Oslo", lat: 59.9139, lng: 10.7522 },
  { id: "Stockholm", lat: 59.3293, lng: 18.0686 },
  { id: "Tehran", lat: 35.6892, lng: 51.3890 },
  { id: "Baghdad", lat: 33.3152, lng: 44.3661 },
  { id: "Auckland", lat: -36.8485, lng: 174.7633 },
  { id: "Honolulu", lat: 21.3069, lng: -157.8583 },
  { id: "Hanoi", lat: 21.0285, lng: 105.8542 },
  { id: "Casablanca", lat: 33.5731, lng: -7.5898 },
  { id: "Lisbon", lat: 38.7223, lng: -9.1393 }
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ATTACKS = ["DDoS", "Brute Force", "SQL Injection", "Port Scan"];

/**
 * Threat levels + warna (CSS hex). Bobot menentukan probabilitas.
 * - weight: relatif peluang dipilih
 * - color: hex untuk dipakai client/visual
 */
const THREAT_LEVELS = [
  { level: "Low", weight: 50, color: "#00C853" },      // green
  { level: "Medium", weight: 30, color: "#FFEB3B" },   // yellow
  { level: "High", weight: 15, color: "#FF9800" },     // orange
  { level: "Critical", weight: 5, color: "#D50000" }   // red
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

/**
 * TARGET PUSAT: semua serangan diarahkan ke sini.
 * Ganti CENTER sesuai kebutuhan Anda.
 */
const CENTER = { id: "Home", lat: -6.177463257461286 , lng: 106.83199928943905 }; // contoh: Singapore

function genEvent() {
  const src = pick(LOCATIONS);
  const threat = pickWeighted(THREAT_LEVELS);

  // kita buat strength sedikit tergantung level (opsional)
  const baseStrength = Math.floor(Math.random() * 50) + 10; // 10..59
  const strengthBoost = threat.level === "Critical" ? 40 : threat.level === "High" ? 20 : threat.level === "Medium" ? 8 : 0;
  const strength = Math.min(100, baseStrength + strengthBoost);

  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    attackType: pick(ATTACKS),
    source: src,
    target: CENTER,
    timestamp: Date.now(),
    threatLevel: threat.level,   // "Low" | "Medium" | "High" | "Critical"
    color: threat.color,         // CSS hex string, e.g. "#FF9800"
    strength
  };
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.emit("center-info", { center: CENTER, message: "single-target mode with threatLevel" });
});

const EMIT_INTERVAL_MS = 5000;

setInterval(() => {
  const ev = genEvent();
  io.emit("attack-event", ev);
  console.log(
    `[Emit] ${new Date(ev.timestamp).toISOString()} - ${ev.source.id} -> ${ev.target.id} (${ev.attackType}) - ${ev.threatLevel}`
  );
}, EMIT_INTERVAL_MS);

srv.listen(PORT, () => console.log(`Socket server on :${PORT}`));
