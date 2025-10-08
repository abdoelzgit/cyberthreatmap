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
  // Di atas dalam komponen GlobeSocketMap
  const [tick, setTick] = useState(Date.now());
  const socketRef = useRef(null);
  const viewerRef = useRef(null);
  const centersRef = useRef([]);
  const routesRef = useRef(new Map());
  const attackRoutesRef = useRef(new Map());
  const defenseRoutesRef = useRef(new Map());
  const explosionsRef = useRef(new Map());
  const barriersRef = useRef([]); // ✅ tambahkan baris ini
  const initialFlyDoneRef = useRef(false);

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
  // bagian utama useEffect socket listener (paste menggantikan listener lama)
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

    // attack-event now includes timing & intercept info
    socketRef.current.on("attack-event", (e) => {
      const now = Date.now();
      if (!e?.source || !e?.target) return;

      // attack duration = attackTravelTimeMs (ms) but cap to UI-friendly range
      const duration = Math.max(
        1500,
        Math.min(12000, e.attackTravelTimeMs || 4000)
      );
      const color = e.color ? Color.fromCssColorString(e.color) : Color.ORANGE;

      // build positions full path (source -> target)
      const positions = geodesicPositions(
        e.source.lng,
        e.source.lat,
        e.target.lng,
        e.target.lat,
        160
      );
      const id = `atk-${e.id}-${now}`;

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
      });

      // If intercepted, schedule an "air explosion" at intercept time:
      if (
        e.intercepted &&
        e.interceptPoint &&
        e.attackTimeToInterceptMs != null
      ) {
        const interceptAt = now + Math.max(0, e.attackTimeToInterceptMs);
        // schedule explosion / remove attack route at interceptAt
        const to = setTimeout(() => {
          // remove attack route (or trim to intercept)
          // simpler: set route positions to end at intercept point (so animation stops there)
          for (const [k, r] of attackRoutesRef.current) {
            if (r.id === id) {
              // replace positions with geodesic to intercept
              const shortPos = geodesicPositions(
                r.source.lon,
                r.source.lat,
                e.interceptPoint.lng,
                e.interceptPoint.lat,
                120
              );
              attackRoutesRef.current.set(k, {
                ...r,
                positions: shortPos,
                duration: 1200,
                createdAt: Date.now() - 100,
              }); // let it animate quickly to intercept
              break;
            }
          }
          // create small visual explosion entity by adding to explosionsRef (reuse explosionsRef logic if you have it)
          const expKey = `exp-${id}`;
          explosionsRef.current = explosionsRef.current || new Map();
          explosionsRef.current.set(expKey, {
            point: { lng: e.interceptPoint.lng, lat: e.interceptPoint.lat },
            color,
            createdAt: Date.now(),
          });
          setTick(Date.now());
          // auto remove explosion after ~1.5s
          setTimeout(() => {
            explosionsRef.current.delete(expKey);
            setTick(Date.now());
          }, 1500);
        }, Math.max(0, e.attackTimeToInterceptMs));
        // track timeout to clear if necessary
        (attackRoutesRef.current.__timeouts =
          attackRoutesRef.current.__timeouts || []).push(to);
      }

      setTick(Date.now());
    });

    // defense-launch: server sends it instantly but includes delay — client schedules actual visual launch
    socketRef.current.on("defense-launch", (p) => {
      const delay = p.delay || 0;
      const now = Date.now();
      const scheduleAt = now + delay;
      const doLaunch = () => {
        const id = `def-${p.id}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        // defense path from center -> intercept point
        const pos = geodesicPositions(
          p.center.lng,
          p.center.lat,
          p.threat.lng,
          p.threat.lat,
          160
        );
        // duration proportional to interceptorTimeMs if provided
        const duration = Math.max(
          1000,
          Math.min(8000, p.interceptorTimeMs || 3500)
        );
        defenseRoutesRef.current.set(id, {
          id,
          positions: pos,
          createdAt: Date.now(),
          duration,
          color: Color.CYAN,
          source: p.center,
          target: p.threat,
        });

        // schedule explosion/cleanup at arrival
        const to = setTimeout(() => {
          // create explosion
          const expKey = `def-exp-${id}`;
          explosionsRef.current = explosionsRef.current || new Map();
          explosionsRef.current.set(expKey, {
            point: { lng: p.threat.lng, lat: p.threat.lat },
            color: Color.CYAN,
            createdAt: Date.now(),
          });
          setTick(Date.now());
          // remove explosion
          setTimeout(() => {
            explosionsRef.current.delete(expKey);
            setTick(Date.now());
          }, 1500);
          // remove defense route
          defenseRoutesRef.current.delete(id);
          setTick(Date.now());
        }, duration);
        (defenseRoutesRef.current.__timeouts =
          defenseRoutesRef.current.__timeouts || []).push(to);

        setTick(Date.now());
      };

      const to = setTimeout(doLaunch, delay);
      (defenseRoutesRef.current.__timeouts =
        defenseRoutesRef.current.__timeouts || []).push(to);
    });

    return () => {
      socketRef.current?.disconnect();
      // clear any scheduled timeouts
      (attackRoutesRef.current.__timeouts || []).forEach((t) =>
        clearTimeout(t)
      );
      (defenseRoutesRef.current.__timeouts || []).forEach((t) =>
        clearTimeout(t)
      );
      attackRoutesRef.current.clear();
      defenseRoutesRef.current.clear();
      centersRef.current = [];
      barriersRef.current = [];
    };
  }, []);

  // Cleanup animasi
  useEffect(() => {
    const intv = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of attackRoutesRef.current) {
        if (now - v.createdAt > v.duration + 3000)
          attackRoutesRef.current.delete(k);
      }
      for (const [k, v] of defenseRoutesRef.current) {
        if (now - v.createdAt > v.duration + 3000)
          defenseRoutesRef.current.delete(k);
      }
      setTick(now);
    }, 500);
    return () => clearInterval(intv);
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
            <Entity
              polyline={{
                positions: generateCirclePositions(c.lng, c.lat, 1500000, 128),
                width: 2,
                material: Color.LIME.withAlpha(0.5),
              }}
            />
          </Entity>
        ))}

        {/* Rudal musuh */}
        {Array.from(attackRoutesRef.current.values()).map((r) => {
          const animated = new CallbackProperty(() => {
            const t = Math.min((Date.now() - r.createdAt) / r.duration, 1);
            return r.positions.slice(0, Math.floor(t * r.positions.length));
          }, false);
          const movingPoint = new CallbackProperty(() => {
            const t = Math.min((Date.now() - r.createdAt) / r.duration, 1);
            return r.positions[Math.floor(t * (r.positions.length - 1))];
          }, false);
          return (
            <Entity key={r.id}>
              <Entity
                polyline={{
                  positions: animated,
                  width: 4,
                  material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.2,
                    color: r.color,
                  }),
                }}
              />
              <Entity
                position={movingPoint}
                point={{
                  pixelSize: 10,
                  color: r.color,
                  outlineColor: Color.WHITE,
                  outlineWidth: 2,
                }}
              />
            </Entity>
          );
        })}

        {/* Rudal pencegat */}
        {Array.from(defenseRoutesRef.current.values()).map((r) => {
          const animated = new CallbackProperty(() => {
            const t = Math.min((Date.now() - r.createdAt) / r.duration, 1);
            return r.positions.slice(0, Math.floor(t * r.positions.length));
          }, false);
          const movingPoint = new CallbackProperty(() => {
            const t = Math.min((Date.now() - r.createdAt) / r.duration, 1);
            return r.positions[Math.floor(t * (r.positions.length - 1))];
          }, false);
          return (
            <Entity key={r.id}>
              <Entity
                polyline={{
                  positions: animated,
                  width: 6,
                  material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.5,
                    color: r.color,
                  }),
                }}
              />
              <Entity
                position={movingPoint}
                point={{
                  pixelSize: 12,
                  color: r.color,
                  outlineColor: Color.WHITE,
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
