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
const ATTACK_SPEED_MPS = 30000;
// ====================================================
// Helper Functions
// ====================================================
function geodesicPositions(
  lon1,
  lat1,
  lon2,
  lat2,
  segments = 128,
  baseHeight = 15000
) {
  const start = Cartographic.fromDegrees(lon1, lat1);
  const end = Cartographic.fromDegrees(lon2, lat2);
  const geo = new EllipsoidGeodesic(start, end);
  const pos = [];

  // Calculate distance to determine arc height
  const distance = geo.surfaceDistance;
  // More reasonable arc height: max 30km, or 3% of distance, whichever is smaller
  const maxArcHeight = Math.min(distance * 0.03, 30000);

  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const p = geo.interpolateUsingFraction(f);

    // Create smoother arc using quadratic curve: higher in middle, lower at ends
    // Using 4*f*(1-f) creates a nice parabolic shape that peaks at 0.25 height
    const arcFactor = 4 * f * (1 - f);
    const height = baseHeight + (maxArcHeight * arcFactor);

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

  const barriersRef = useRef([]);
  const initialFlyDoneRef = useRef(false);
  const rafRef = useRef(null);

  // Fungsi untuk kembali ke lokasi server (pusat pertahanan pertama)
  const handleRecenterMap = () => {
    const viewer = viewerRef.current?.cesiumElement;
    if (viewer && centersRef.current.length > 0) {
      const firstCenter = centersRef.current[0];
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(
          firstCenter.lng,
          firstCenter.lat,
          800000
        ),
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

    // ATTACK-EVENT: buat route attack seperti threat map biasa
    socketRef.current.on("attack-event", (e) => {
      const now = Date.now();
      if (!e?.source || !e?.target) return;

      const duration = Math.max(
        3000,
        Math.min(20000, e.attackTravelTimeMs || 8000)
      );
      const color = e.color ? Color.fromCssColorString(e.color) : Color.ORANGE;

      const positions = geodesicPositions(
        e.source.lng,
        e.source.lat,
        e.target.lng,
        e.target.lat,
        300
      );
      const id = `atk-${e.id}-${now}`;

      // Store attack route dengan animasi threat map - garis lurus yang fade setelah selesai
      attackRoutesRef.current.set(id, {
        id,
        positions,
        createdAt: now,
        duration,
        color,
        source: { lon: e.source.lng, lat: e.source.lat },
        target: { lon: e.target.lng, lat: e.target.lat },
        frac: 0, // current fraction
        attackId: e.id,
        completed: false, // flag apakah attack sudah selesai
        fadeStartTime: null, // waktu mulai fade
        fadeDuration: 2000, // durasi fading 2 detik
      });

      console.log(
        `🚀 ATTACK ROUTE CREATED: ${id} from ${e.source.id} to ${e.target.id} (threat map style)`
      );
      setTick(Date.now());
    });

    // DEFENSE-LAUNCH: Create interceptor route from server data

    // ATTACK-UPDATE: Update attack position from server
    // ATTACK-UPDATE: Update attack position from server
    socketRef.current.on("attack-update", (update) => {
      // Find the attack route by attackId
      for (const [key, route] of attackRoutesRef.current) {
        if (route.attackId === update.id) {
          // Update position based on fraction from server
          route.frac = update.frac;

          // Update current position from server pos if available
          if (update.pos) {
            route.currentPosition = Cartesian3.fromDegrees(
              update.pos.lng,
              update.pos.lat,
              100000
            );
          } else {
            // Fallback to calculated position
            const idx = Math.floor(update.frac * (route.positions.length - 1));
            route.currentPosition =
              route.positions[idx] ||
              route.positions[route.positions.length - 1];
          }

          // Check if attack is completed
          if (update.frac >= 1 && !route.completed) {
            route.completed = true;
            route.fadeStartTime = Date.now();
            console.log(`✨ ATTACK COMPLETED: ${key}, starting fade animation`);
          }

          break;
        }
      }
      setTick(Date.now()); // Force re-render
    });

    return () => {
      socketRef.current?.disconnect();
      attackRoutesRef.current.clear();
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
      // Handle attack animation and fading
      for (const [k, r] of attackRoutesRef.current) {
        const nowMs = Date.now();

        // Update fraction if not using server updates (fallback)
        if (!r.currentPosition) {
          const elapsed = nowMs - r.createdAt;
          const progress = Math.min(elapsed / r.duration, 1);
          r.frac = progress;

          if (progress >= 1 && !r.completed) {
            r.completed = true;
            r.fadeStartTime = nowMs;
            console.log(`✨ ATTACK COMPLETED: ${k}, starting fade animation`);
          }
        }

        // Handle fading animation
        if (r.completed && r.fadeStartTime) {
          const fadeElapsed = nowMs - r.fadeStartTime;
          if (fadeElapsed >= r.fadeDuration) {
            attackRoutesRef.current.delete(k);
            console.log(`🗑️ REMOVED FADED ATTACK: ${k}`);
          }
        }
      }

      // HAPUS BLOK INI:
      // for (const [k, r] of defenseRoutesRef.current) {
      //   if (r.frac >= 1) {
      //     defenseRoutesRef.current.delete(k);
      //   }
      // }

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

      {/* Threat Log Card */}
      <div style={{ position: "absolute", bottom: "10px", left: "10px", zIndex: 1000 }}>
        <ThreatLogCard />
      </div>

      <Viewer full ref={viewerRef} timeline={false} animation={false}>
        {/* Defense Centers */}
        {centersRef.current.map((c) => (
          <Entity key={c.id}>
            {/* Detection Radius Circle */}

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
          // Jika sedang fading, animasi fade dari awal ke titik terbaru
          if (r.completed && r.fadeStartTime) {
            const fadeProgress = Math.min(
              (Date.now() - r.fadeStartTime) / r.fadeDuration,
              1
            );

            const fadingPositions = new CallbackProperty(() => {
              const startIndex = Math.floor(fadeProgress * r.positions.length);
              return r.positions.slice(startIndex);
            }, false);

            const fadeColor = new Cesium.ColorMaterialProperty(
              new Cesium.CallbackProperty(() => {
                const alpha = 0.8 * (1 - fadeProgress);
                return r.color.withAlpha(alpha);
              }, false)
            );

            return (
              <Entity key={r.id}>
                <Entity
                  polyline={{
                    positions: fadingPositions,
                    width: 5,
                    material: fadeColor,
                  }}
                />
              </Entity>
            );
          }

          // Animasi normal - selalu ikuti jalur geodesic
          const currentPositions = new CallbackProperty(() => {
            const idx = Math.floor(r.frac * (r.positions.length - 1));
            return r.positions.slice(0, idx + 1);
          }, false);

          const movingPoint = new CallbackProperty(() => {
            // Always use the geodesic position to ensure height consistency
            const idx = Math.floor(r.frac * (r.positions.length - 1));
            return r.positions[idx] || r.positions[r.positions.length - 1];
          }, false);

          return (
            <Entity key={r.id}>
              <Entity
                polyline={{
                  positions: currentPositions,
                  width: 5,
                  material: r.color.withAlpha(0.8),
                }}
              />
              <Entity
                position={movingPoint}
                point={{
                  pixelSize: 12,
                  color: r.color,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                }}
              />
            </Entity>
          );
        })}
      </Viewer>
    </div>
  );
}
