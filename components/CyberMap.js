"use client";

import { useEffect, useRef, useState } from "react";
import { Viewer, Entity } from "resium";
import {
  Cartesian3,
  Color,
  Cartographic,
  EllipsoidGeodesic,
  CallbackProperty,
} from "cesium";
import io from "socket.io-client";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import ThreatLogCard from "./LogCard";

Cesium.Ion.defaultAccessToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "";

// ====================================================
// Konstanta (kecepatan dll.)
// NOTE: samakan dengan server jika ingin konsisten
const ATTACK_SPEED_MPS = 800;
const INTERCEPTOR_SPEED_MPS = 1200;
const COLLISION_THRESHOLD = 50000; // 50 km (ubah jika perlu)

// ====================================================
// Helper Functions
// ====================================================
function geodesicPositions(
  lon1,
  lat1,
  lon2,
  lat2,
  segments = 128,
  height = 100000
) {
  const start = Cartographic.fromDegrees(lon1, lat1);
  const end = Cartographic.fromDegrees(lon2, lat2);
  const geo = new EllipsoidGeodesic(start, end);
  const pos = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const p = geo.interpolateUsingFraction(f);
    pos.push(Cartesian3.fromRadians(p.longitude, p.latitude, height));
  }
  return pos;
}

function generateCirclePositions(lon, lat, radiusMeters, segments = 64) {
  const positions = [];
  const R = 6371000;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    const dLat = (radiusMeters / R) * Math.cos(theta);
    const dLon =
      ((radiusMeters / R) * Math.sin(theta)) / Math.cos((lat * Math.PI) / 180);
    const pLat = lat + (dLat * 180) / Math.PI;
    const pLon = lon + (dLon * 180) / Math.PI;
    positions.push(Cartesian3.fromDegrees(pLon, pLat, 0));
  }
  return positions;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Hitung titik pertemuan (intercept) */
function computeInterceptPoint(source, target, center) {
  const geoST = new EllipsoidGeodesic(
    Cartographic.fromDegrees(source.lng, source.lat),
    Cartographic.fromDegrees(target.lng, target.lat)
  );
  const geoCT = new EllipsoidGeodesic(
    Cartographic.fromDegrees(center.lng, center.lat),
    Cartographic.fromDegrees(target.lng, target.lat)
  );
  const dST = geoST.surfaceDistance;
  const dCT = geoCT.surfaceDistance;
  const speedRatio = 1.5; // pencegat lebih cepat
  const interceptFraction = dCT / (dCT + dST / speedRatio);
  const interceptGeo = geoCT.interpolateUsingFraction(1 - interceptFraction);
  return {
    lat: Cesium.Math.toDegrees(interceptGeo.latitude),
    lng: Cesium.Math.toDegrees(interceptGeo.longitude),
  };
}

  // ====================================================
  // Komponen Utama
  // ====================================================
  export default function GlobeSocketMap() {
    const [tick, setTick] = useState(Date.now());
    const socketRef = useRef(null);
    const viewerRef = useRef(null);
    const centersRef = useRef([]);
    const routesRef = useRef(new Map());
    const attackRoutesRef = useRef(new Map());
    const defenseRoutesRef = useRef(new Map());
    const explosionsRef = useRef(new Map());
    const barriersRef = useRef([]);
    const initialFlyDoneRef = useRef(false);
    const rafRef = useRef(null);

    // Fungsi untuk kembali ke lokasi server (pusat pertahanan pertama)
    const handleRecenterMap = () => {
      const viewer = viewerRef.current?.cesiumElement;
      if (viewer && centersRef.current.length > 0) {
        const firstCenter = centersRef.current[0];
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(firstCenter.lng, firstCenter.lat, 800000),
          duration: 1.5,
        });
      }
    };

  // Kamera awal
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    viewer?.camera.flyTo({
      destination: Cartesian3.fromDegrees(0, 20, 20000000),
      duration: 1.5,
    });
  }, []);

  // ====================================================
  // SOCKET SETUP
  // ====================================================
  useEffect(() => {
    console.log("🔌 Connecting to socket server...");
    socketRef.current = io("http://localhost:4000");

    socketRef.current.on("connect", () => {
      console.log("✅ Socket connected successfully");
    });

    socketRef.current.on("disconnect", () => {
      console.log("❌ Socket disconnected");
    });

    socketRef.current.on("connect_error", (error) => {
      console.error("🔌 Socket connection error:", error);
    });

    socketRef.current.on("center-info", (data) => {
      if (data?.centers) centersRef.current = data.centers;
      if (data?.barriers) barriersRef.current = data.barriers;
      if (!initialFlyDoneRef.current && centersRef.current.length > 0) {
        const first = centersRef.current[0];
        viewerRef.current?.cesiumElement?.camera.flyTo({
          destination: Cartesian3.fromDegrees(first.lng, first.lat, 800000),
          duration: 2,
        });
        initialFlyDoneRef.current = true;
      }
      setTick(Date.now());
    });

    // ATTACK-EVENT: hanya buat route awal, biarkan server mengatur interceptor
    socketRef.current.on("attack-event", (e) => {
      const now = Date.now();
      if (!e?.source || !e?.target) return;

      const duration = Math.max(
        1500,
        Math.min(12000, e.attackTravelTimeMs || 4000)
      );
      const color = e.color ? Color.fromCssColorString(e.color) : Color.ORANGE;

      const positions = geodesicPositions(
        e.source.lng,
        e.source.lat,
        e.target.lng,
        e.target.lat,
        160
      );
      const id = `atk-${e.id}-${now}`;

      // Store attack route - will be updated by server via attack-update
      attackRoutesRef.current.set(id, {
        id,
        positions,
        createdAt: now,
        duration,
        color,
        source: { lon: e.source.lng, lat: e.source.lat },
        target: { lon: e.target.lng, lat: e.target.lat },
        currentPosition: positions[0], // start at source
        frac: 0, // current fraction
        attackId: e.id, // link to server attack ID
      });

      console.log(`🚀 ATTACK ROUTE CREATED: ${id} from ${e.source.id} to ${e.target.id}`);
      setTick(Date.now());
    });

    // DEFENSE-LAUNCH: Create interceptor route from server data
    socketRef.current.on("defense-launch", (p) => {
      console.log("🛡️ RECEIVED defense-launch:", p.simId, "from", p.center.id);

      // Calculate positions from center to target (server already calculated intercept point)
      const positions = geodesicPositions(
        p.center.lng,
        p.center.lat,
        p.threat.lng, // target of attack
        p.threat.lat,
        160
      );

      const id = `def-${p.simId}`;

      defenseRoutesRef.current.set(id, {
        id,
        positions,
        createdAt: p.launchTime,
        duration: p.interceptorTimeMs,
        color: Color.CYAN,
        source: p.center,
        target: p.threat,
        currentPosition: positions[0], // start at center
        frac: 0, // current fraction
        simId: p.simId, // link to server simulation ID
      });

      console.log(`🚀 DEFENSE ROUTE CREATED: ${id} from ${p.center.id} to intercept missile`);
      setTick(Date.now());
    });

    // ATTACK-UPDATE: Update attack position from server
    socketRef.current.on("attack-update", (update) => {
      // Find the attack route by attackId
      for (const [key, route] of attackRoutesRef.current) {
        if (route.attackId === update.id) {
          // Update position based on fraction from server
          const idx = Math.floor(update.frac * (route.positions.length - 1));
          route.currentPosition = route.positions[idx] || route.positions[route.positions.length - 1];
          route.frac = update.frac;
          break;
        }
      }
    });

    // DEFENSE-UPDATE: Update defense position from server
    socketRef.current.on("defense-update", (update) => {
      // Find the defense route by simId
      for (const [key, route] of defenseRoutesRef.current) {
        if (route.simId === update.simId) {
          // Update position based on fraction from server
          const idx = Math.floor(update.fracIntercept * (route.positions.length - 1));
          route.currentPosition = route.positions[idx] || route.positions[route.positions.length - 1];
          route.frac = update.fracIntercept;
          break;
        }
      }
    });

    // INTERCEPT-RESULT: Handle interception results
    socketRef.current.on("intercept-result", (result) => {
      console.log("💥 RECEIVED intercept-result:", result.simId, "intercepted:", result.intercepted, "distance:", result.collisionDistance || "N/A");
      if (result.intercepted) {
        // Remove attack route
        attackRoutesRef.current.forEach((route, key) => {
          if (route.attackId === result.attackId) {
            console.log("🗑️ REMOVING ATTACK ROUTE:", key);
            attackRoutesRef.current.delete(key);
          }
        });

        // Remove defense route
        defenseRoutesRef.current.forEach((route, key) => {
          if (route.simId === result.simId) {
            console.log("🗑️ REMOVING DEFENSE ROUTE:", key);
            defenseRoutesRef.current.delete(key);
          }
        });

        setTick(Date.now());
      }
    });

    return () => {
      socketRef.current?.disconnect();
      attackRoutesRef.current.clear();
      defenseRoutesRef.current.clear();
      centersRef.current = [];
      barriersRef.current = [];
    };
  }, []);

  // ====================================================
  // Per-frame animation (positions updated by server events)
  // ====================================================
  useEffect(() => {
    let last = performance.now();

    function frame(now) {
      const delta = now - last;
      last = now;

      const nowMs = Date.now();

      // Only handle cleanup for finished routes - positions are updated by server
      for (const [k, r] of attackRoutesRef.current) {
        if (r.frac >= 1) {
          attackRoutesRef.current.delete(k);
        }
      }

      for (const [k, r] of defenseRoutesRef.current) {
        if (r.frac >= 1) {
          defenseRoutesRef.current.delete(k);
        }
      }

      // Force periodic render updates for smooth animation
      if (nowMs % 100 < 10) setTick(Date.now()); // ~every 100ms

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ====================================================
  // RENDER CESIUM
  // ====================================================
  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>

      {/* Tombol Recenter Map */}
      <button
        onClick={handleRecenterMap}
        style={{
          position: "absolute",
          top: "5px",
          right: "200px",
          zIndex: 1000,
          padding: "10px 15px",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "5px",
          cursor: "pointer",
          fontSize: "14px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
        }}
        onMouseOver={(e) => (e.target.style.backgroundColor = "#0056b3")}
        onMouseOut={(e) => (e.target.style.backgroundColor = "#007bff")}
      >
        Recenter Map
      </button>

      <Viewer full ref={viewerRef} timeline={false} animation={false}>
        {/* Defense Centers */}
        {centersRef.current.map((c) => (
          <Entity key={c.id}>
            {/* Detection Radius Circle */}
            <Entity>
              <Entity
                position={Cartesian3.fromDegrees(c.lng, c.lat, 0)}
                ellipse={{
                  semiMinorAxis: 1000000, // 6000km radius (sama dengan server)
                  semiMajorAxis: 1000000, // 6000km radius (sama dengan server)
                  height: 0,
                  material: Color.LIME.withAlpha(0.1), // hijau pudar
                  outline: true,
                  outlineColor: Color.LIME.withAlpha(0.3),
                  outlineWidth: 2,
                }}
              />
            </Entity>
            {/* Center Point */}
            <Entity
              position={Cartesian3.fromDegrees(c.lng, c.lat, 100000)}
              point={{
                pixelSize: 12,
                color: Color.LIME,
                outlineColor: Color.BLACK,
                outlineWidth: 2,
              }}
            />
          </Entity>
        ))}

        {/* Rudal musuh */}
        {Array.from(attackRoutesRef.current.values()).map((r) => {
          const animated = new CallbackProperty(() => {
            // trail: last ~10% of positions up to current index
            const nowMs = Date.now();
            const t = Math.min((nowMs - r.createdAt) / r.duration, 1);
            const idx = Math.floor(t * r.positions.length);
            const tailLength = Math.floor(r.positions.length * 0.1);
            const startIdx = Math.max(0, idx - tailLength);
            return r.positions.slice(startIdx, idx);
          }, false);

          const movingPoint = new CallbackProperty(() => {
            // return currentPosition if available (updated in RAF), fallback to computed
            if (r.currentPosition) return r.currentPosition;
            const t = Math.min((Date.now() - r.createdAt) / r.duration, 1);
            return r.positions[Math.floor(t * (r.positions.length - 1))];
          }, false);

          const trailColor = Cesium.Color.ORANGE.withAlpha(0.8);

          return (
            <Entity key={r.id}>
              <Entity
                polyline={{
                  positions: animated,
                  width: 5,
                  material: trailColor,
                }}
              />
              <Entity
                position={movingPoint}
                point={{
                  pixelSize: 12,
                  color: Cesium.Color.YELLOW,
                  outlineColor: Cesium.Color.ORANGE,
                  outlineWidth: 3,
                }}
              />
            </Entity>
          );
        })}

        {/* Rudal pencegat */}
        {Array.from(defenseRoutesRef.current.values()).map((r) => {
          // Menampilkan hanya 10% terakhir dari lintasan (trail pendek)
          const animated = new CallbackProperty(() => {
            const nowMs = Date.now();
            const t = Math.min((nowMs - r.createdAt) / r.duration, 1);
            const idx = Math.floor(t * r.positions.length);
            const tailLength = Math.floor(r.positions.length * 0.1); // 10% trail
            const startIdx = Math.max(0, idx - tailLength);
            return r.positions.slice(startIdx, idx);
          }, false);

          // Titik biru bergerak di ujung lintasan
          const movingPoint = new CallbackProperty(() => {
            if (r.currentPosition) return r.currentPosition;
            const t = Math.min((Date.now() - r.createdAt) / r.duration, 1);
            return r.positions[Math.floor(t * (r.positions.length - 1))];
          }, false);

          // Efek fading / pulsasi warna biru
          const trailColor = new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => {
              const t = (Date.now() - r.createdAt) / r.duration;
              const alpha = 0.3 + 0.7 * Math.sin(t * Math.PI); // fade lembut
              return Cesium.Color.CYAN.withAlpha(alpha);
            }, false)
          );

          return (
            <Entity key={r.id}>
              {/* Jejak rudal pencegat (trail) */}
              <Entity
                polyline={{
                  positions: animated,
                  width: 5,
                  material: trailColor,
                }}
              />
              {/* Kepala rudal pencegat */}
              <Entity
                position={movingPoint}
                point={{
                  pixelSize: 14,
                  color: Cesium.Color.CYAN,
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 3,
                }}
              />
            </Entity>
          );
        })}
      </Viewer>
    </div>
  );
}
