"use client";

import { useEffect, useRef, useState } from "react";
import { Viewer, Entity } from "resium";
import {
  Cartesian3,
  Color,
  CallbackProperty,
  PolylineGlowMaterialProperty,
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
    socketRef.current = io("http://localhost:4000");

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

    // ATTACK-EVENT: buat route dan jadwalkan peluncuran interceptor dari center terbaik
    socketRef.current.on("attack-event", (e) => {
      const now = Date.now();
      if (!e?.source || !e?.target) return;

      const duration = Math.max(
        1500,
        Math.min(12000, e.attackTravelTimeMs || 4000)
      );
      const color = e.color ? Color.fromCssColorString(e.color) : Color.ORANGE;

      // IMPORTANT: arahkan rudal musuh FROM source -> target (pakai e.target as position if lat/lng present)
      // If server's e.target is a center object with lat/lng, use that; else fallback to provided coords
      const targetLng =
        e.target.lng ?? e.target.lon ?? e.target.longitude ?? e.target.lon;
      const targetLat =
        e.target.lat ?? e.target.lat ?? e.target.latitude ?? e.target.lat;

      // gunakan e.target.lng / lat as provided originally (keamanan: fallback to e.target.lng)
      const positions = geodesicPositions(
        e.source.lng,
        e.source.lat,
        e.target.lng,
        e.target.lat,
        160
      );
      const id = `atk-${e.id}-${now}`;

      // store the route object and also a currentPosition field updated per-frame
      attackRoutesRef.current.set(id, {
        id,
        positions,
        createdAt: now,
        duration,
        color,
        source: { lon: e.source.lng, lat: e.source.lat },
        target: { lon: e.target.lng, lat: e.target.lat },
        interceptPoint: e.interceptPoint || null,
        attackTimeToInterceptMs: e.attackTimeToInterceptMs || null,
        currentPosition: null,
      });

      // pilih center terbaik: paling mungkin intercept
      if (centersRef.current.length > 0) {
        let best = null;
        for (const c of centersRef.current) {
          const ip = computeInterceptPoint(e.source, e.target, c);

          const distCenterToIntercept = haversine(c.lat, c.lng, ip.lat, ip.lng);
          const distAttackToIntercept = haversine(
            e.source.lat,
            e.source.lng,
            ip.lat,
            ip.lng
          );

          const attackTimeToInterceptMs =
            (distAttackToIntercept / ATTACK_SPEED_MPS) * 1000;
          const interceptorTimeMs =
            (distCenterToIntercept / INTERCEPTOR_SPEED_MPS) * 1000;

          const willIntercept = interceptorTimeMs <= attackTimeToInterceptMs;
          const delay = Math.max(
            0,
            attackTimeToInterceptMs - interceptorTimeMs
          );

          if (
            !best ||
            (willIntercept && !best.willIntercept) ||
            (willIntercept === best.willIntercept &&
              interceptorTimeMs < best.interceptorTimeMs)
          ) {
            best = {
              center: c,
              ip,
              distCenterToIntercept,
              distAttackToIntercept,
              interceptorTimeMs,
              attackTimeToInterceptMs,
              delay,
              willIntercept,
            };
          }
        }

        if (best) {
          // schedule client-side defense launch so visuals align perfectly
          const launchDelay = Math.round(best.delay); // ms
          setTimeout(() => {
            const defId = `def-${id}-${best.center.id}-${Date.now()}`;
            const pos = geodesicPositions(
              best.center.lng,
              best.center.lat,
              best.ip.lng,
              best.ip.lat,
              160
            );
            const defDuration = Math.max(
              1000,
              Math.min(8000, best.interceptorTimeMs || 3000)
            );
            defenseRoutesRef.current.set(defId, {
              id: defId,
              positions: pos,
              createdAt: Date.now(),
              duration: defDuration,
              color: Color.CYAN,
              source: best.center,
              target: best.ip,
              currentPosition: null,
            });

            // force immediate render so it appears without sticky frames
            setTick(Date.now());
          }, launchDelay);
        }
      }

      setTick(Date.now());
    });

    // Keep server-initiated defense-launch handler (honor intercept point if provided)
    socketRef.current.on("defense-launch", (p) => {
      const intercept = p.interceptPoint || p.threat;
      const id = `def-${p.id}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const pos = geodesicPositions(
        p.center.lng,
        p.center.lat,
        intercept.lng,
        intercept.lat,
        160
      );
      const duration = Math.max(
        1000,
        Math.min(8000, p.interceptorTimeMs || 3500)
      );
      const delay = p.delay || 0;
      setTimeout(() => {
        defenseRoutesRef.current.set(id, {
          id,
          positions: pos,
          createdAt: Date.now(),
          duration,
          color: Color.CYAN,
          source: p.center,
          target: intercept,
          currentPosition: null,
        });
        setTick(Date.now());
      }, delay);
    });

    return () => {
      socketRef.current?.disconnect();
      attackRoutesRef.current.clear();
      defenseRoutesRef.current.clear();
      centersRef.current = [];
    };
  }, []);

  // ====================================================
  // Per-frame animation + collision detection (requestAnimationFrame)
  // ====================================================
  useEffect(() => {
    let last = performance.now();

    function frame(now) {
      const delta = now - last;
      last = now;

      const nowMs = Date.now();

      // update currentPosition for each attack route
      for (const [k, r] of attackRoutesRef.current) {
        const elapsed = nowMs - r.createdAt;
        const t = Math.min(Math.max(elapsed / r.duration, 0), 1);
        const idx = Math.floor(t * (r.positions.length - 1));
        r.currentPosition =
          r.positions[idx] || r.positions[r.positions.length - 1];

        // if it finished, schedule removal (keeps same behavior as before)
        if (t >= 1) {
          // remove soon (keep one extra frame)
          attackRoutesRef.current.delete(k);
        }
      }

      // update currentPosition for each defense route
      for (const [k, r] of defenseRoutesRef.current) {
        const elapsed = nowMs - r.createdAt;
        const t = Math.min(Math.max(elapsed / r.duration, 0), 1);
        const idx = Math.floor(t * (r.positions.length - 1));
        r.currentPosition =
          r.positions[idx] || r.positions[r.positions.length - 1];

        if (t >= 1) {
          defenseRoutesRef.current.delete(k);
        }
      }

      // collision detection: compare every attack vs every defense (small N expected)
      let collisionHappened = false;
      const attacks = Array.from(attackRoutesRef.current.values());
      const defenses = Array.from(defenseRoutesRef.current.values());

      for (const atk of attacks) {
        if (!atk.currentPosition) continue;
        for (const def of defenses) {
          if (!def.currentPosition) continue;
          const dist = Cartesian3.distance(
            atk.currentPosition,
            def.currentPosition
          );
          if (dist < COLLISION_THRESHOLD) {
            // remove both immediately
            attackRoutesRef.current.delete(atk.id);
            defenseRoutesRef.current.delete(def.id);
            collisionHappened = true;
            // break inner; continue checking other pairs
            break;
          }
        }
      }

      // If collision happened, force render immediately
      if (collisionHappened) setTick(Date.now());
      // otherwise, occasionally update tick so CallbackPropertys re-evaluate
      else if (nowMs % 200 < 20) setTick(Date.now()); // light periodic update (~every 200ms)

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
      <div className="absolute top-4 left-4 z-50">
        <ThreatLogCard />
      </div>

      <Viewer full ref={viewerRef} timeline={false} animation={false}>
        {/* Defense Centers */}
        {centersRef.current.map((c) => (
          <Entity key={c.id}>
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

          const trailColor = new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => {
              const t = (Date.now() - r.createdAt) / r.duration;
              const alpha = 0.2 + 0.8 * Math.sin(t * Math.PI);
              return Cesium.Color.ORANGE.withAlpha(alpha);
            }, false)
          );

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
