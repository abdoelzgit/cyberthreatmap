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
import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import ThreatLogCard from "./LogCard";

Cesium.Ion.defaultAccessToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "";

function geodesicPositions(lon1, lat1, lon2, lat2, segments = 128) {
  const startCarto = Cartographic.fromDegrees(lon1, lat1);
  const endCarto = Cartographic.fromDegrees(lon2, lat2);
  const geodesic = new EllipsoidGeodesic(startCarto, endCarto);
  const positions = [];
  for (let i = 0; i <= segments; i++) {
    const frac = i / segments;
    const carto = geodesic.interpolateUsingFraction(frac);
    positions.push(
      Cartesian3.fromRadians(carto.longitude, carto.latitude, 100000)
    );
  }
  return positions;
}

function generateCirclePositions(lon, lat, radiusMeters, segments = 64) {
  const positions = [];
  const R = 6371000; // radius Bumi (m)

  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    const deltaLat = (radiusMeters / R) * Math.cos(theta);
    const deltaLon =
      (radiusMeters / R) * Math.sin(theta) / Math.cos((lat * Math.PI) / 180);

    const pLat = lat + (deltaLat * 180) / Math.PI;
    const pLon = lon + (deltaLon * 180) / Math.PI;

    positions.push(Cartesian3.fromDegrees(pLon, pLat, 0));
  }

  return positions;
}

export default function GlobeSocketMap() {
  const viewerRef = useRef(null);
  const socketRef = useRef(null);
  const routesRef = useRef(new Map());
  const explosionsRef = useRef(new Map());
  const deflectsRef = useRef(new Map());
  const centersRef = useRef([]); // simpan centers dari server
  const barriersRef = useRef([]); // simpan barriers dari server
  const initialFlyDoneRef = useRef(false); // <-- pastikan fly sekali saja
  const [, setTick] = useState(0);

  /** 🎥 Kamera awal (view global) */
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (viewer) {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(0, 20, 20000000),
        duration: 1.2,
      });
    }
  }, []);

  /** 🌐 Socket listener */
  useEffect(() => {
    socketRef.current = io("http://localhost:4000");

    // terima info center & barrier sejak awal (server mengemit saat koneksi)
    socketRef.current.on("center-info", (data) => {
      if (data?.centers) centersRef.current = data.centers;
      if (data?.barriers) barriersRef.current = data.barriers;

      // Jika belum melakukan initial fly dan ada centers, fly ke center pertama
      if (!initialFlyDoneRef.current && centersRef.current.length > 0) {
        const viewer = viewerRef.current?.cesiumElement;
        if (viewer) {
          const first = centersRef.current[0];
          // sesuaikan altitude/duration sesuai preferensi
          viewer.camera.flyTo({
            destination: Cartesian3.fromDegrees(first.lng, first.lat, 800000),
            duration: 2.0,
            easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
          });
          initialFlyDoneRef.current = true;
        }
      }

      setTick(Date.now()); // paksa rerender untuk menampilkan centers/barriers
    });

    socketRef.current.on("server-status", (st) => {
      console.log("server-status:", st);
    });

    socketRef.current.on("attack-event", (e) => {
      const lonA = e.source.lng;
      const latA = e.source.lat;
      const now = Date.now();
      const duration = 4000;

      e.targets.forEach((t, i) => {
        const lonB = t.blocked && t.blockedPoint ? t.blockedPoint.lng : t.lng;
        const latB = t.blocked && t.blockedPoint ? t.blockedPoint.lat : t.lat;
        const positions = geodesicPositions(lonA, latA, lonB, latB, 160);

        const hasDeflect = !!t.deflectPoint;
        const color = e.color
          ? Color.fromCssColorString(e.color)
          : Color.ORANGE;

        const routeKey = `${e.id}-${i}-${now}`;
        routesRef.current.set(routeKey, {
          id: routeKey,
          positions,
          createdAt: now,
          duration,
          color,
          source: { lon: lonA, lat: latA },
          target: { lon: lonB, lat: latB },
          hasDeflect,
        });

        // 💥 Ledakan (jika diblokir)
        if (t.blocked && t.blockedPoint) {
          explosionsRef.current.set(`${routeKey}-explosion`, {
            point: t.blockedPoint,
            color,
            createdAt: now + duration - 500,
          });
        }

        // 🪩 Pantulan (deflect)
        if (hasDeflect) {
          const lonC = t.deflectPoint.lng;
          const latC = t.deflectPoint.lat;
          const deflectPositions = geodesicPositions(
            lonB,
            latB,
            lonC,
            latC,
            160
          );

          deflectsRef.current.set(`${routeKey}-deflect`, {
            positions: deflectPositions,
            createdAt: now + duration,
            duration: 3000,
            color: Color.CYAN,
            point: { lon: lonC, lat: latC },
          });
        }
      });

      setTick(Date.now());
    });

    return () => {
      socketRef.current?.disconnect();
      routesRef.current.clear();
      explosionsRef.current.clear();
      deflectsRef.current.clear();
      centersRef.current = [];
      barriersRef.current = [];
    };
  }, []);

  /** 🧹 Cleanup otomatis */
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, route] of routesRef.current.entries()) {
        if (now - route.createdAt > route.duration + 1000) {
          routesRef.current.delete(key);
        }
      }
      for (const [key, exp] of explosionsRef.current.entries()) {
        if (now - exp.createdAt > 1500) explosionsRef.current.delete(key);
      }
      for (const [key, def] of deflectsRef.current.entries()) {
        if (now - def.createdAt > def.duration + 800)
          deflectsRef.current.delete(key);
      }
      setTick(now);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  /** 🌍 Render globe */
  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      <div className="absolute top-4 left-4 z-50">
        <ThreatLogCard />
      </div>

      <Viewer full ref={viewerRef} timeline={false} animation={false}>
        {/* --- RENDER CENTERS (ditampilkan dari awal saat center-info diterima) --- */}
        {Array.from(centersRef.current || []).map((c) => (
          <Entity key={`center-${c.id}`}>
            <Entity
              position={Cartesian3.fromDegrees(c.lng, c.lat, 50000)}
              point={{
                pixelSize: 10,
                color: Color.WHITE,
                outlineColor: Color.BLACK,
                outlineWidth: 2,
              }}
            />
            <Entity
              position={Cartesian3.fromDegrees(c.lng, c.lat, 50000)}
              label={{
                text: c.id,
                font: "14px sans-serif",
                fillColor: Color.WHITE,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineColor: Color.BLACK,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -12),
              }}
            />
          </Entity>
        ))}

        {/* --- RENDER BARRIERS (ellipse per barrier) --- */}
        {Array.from(barriersRef.current || []).map((b, i) => {
          const circlePositions = generateCirclePositions(
            b.lng,
            b.lat,
            200000,
            128
          ); // 200 km

          return (
            <Entity key={`barrier-circle-${b.id}`}>
              <Entity
                polyline={{
                  positions: circlePositions,
                  width: 2,
                  material: Color.RED,
                  clampToGround: true,
                }}
              />
            </Entity>
          );
        })}

        {/* 🔶 Garis utama (serangan) */}
        {Array.from(routesRef.current.values()).map((route) => {
          const { id, positions, createdAt, duration, color, source, target } =
            route;
          if (!positions?.length) return null;

          const animatedLine = new CallbackProperty(() => {
            const elapsed = Date.now() - createdAt;
            const t = Math.min(elapsed / duration, 1);
            return positions.slice(0, Math.floor(t * positions.length));
          }, false);

          const movingPoint = new CallbackProperty(() => {
            const elapsed = Date.now() - createdAt;
            const t = Math.min(elapsed / duration, 1);
            return positions[Math.floor(t * (positions.length - 1))];
          }, false);

          return (
            <Entity key={id}>
              <Entity
                polyline={{
                  positions: animatedLine,
                  material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.2,
                    color,
                  }),
                  width: 8,
                }}
              />
              <Entity
                position={movingPoint}
                point={{
                  pixelSize: 10,
                  color,
                  outlineColor: Color.WHITE,
                  outlineWidth: 2,
                }}
              />
              <Entity
                position={Cartesian3.fromDegrees(source.lon, source.lat, 50000)}
                point={{
                  pixelSize: 6,
                  color,
                  outlineColor: Color.WHITE,
                  outlineWidth: 1,
                }}
              />
              <Entity
                position={Cartesian3.fromDegrees(target.lon, target.lat, 50000)}
                point={{
                  pixelSize: 8,
                  color: Color.WHITE,
                  outlineColor: color,
                  outlineWidth: 3,
                }}
              />
            </Entity>
          );
        })}

        {/* 💥 Ledakan */}
        {Array.from(explosionsRef.current.values()).map((exp, i) => {
          const viewer = viewerRef.current?.cesiumElement;
          const elapsed = Date.now() - exp.createdAt;
          if (elapsed > 2000 || elapsed < 0) return null;

          const cameraHeight =
            viewer?.camera?.positionCartographic?.height || 20000000;
          const scale = Math.max(0.5, 1.5e7 / cameraHeight);

          const radius = (150000 + (elapsed / 2000) * 400000) * scale;
          const alpha = 1 - elapsed / 2000;

          if (elapsed < 300 && viewer) {
            viewer.camera.flyTo({
              destination: Cartesian3.fromDegrees(
                exp.point.lng,
                exp.point.lat,
                800000 * scale
              ),
              duration: 1.5,
            });
          }

          return (
            <Entity
              key={`exp-${i}`}
              position={Cartesian3.fromDegrees(
                exp.point.lng,
                exp.point.lat,
                20000
              )}
              ellipse={{
                semiMajorAxis: radius,
                semiMinorAxis: radius,
                material: new Cesium.ColorMaterialProperty(
                  exp.color.withAlpha(alpha * 0.8)
                ),
                height: 0,
              }}
            />
          );
        })}

        {/* 🪩 Pantulan */}
        {Array.from(deflectsRef.current.values()).map((def, i) => {
          const viewer = viewerRef.current?.cesiumElement;
          const elapsed = Date.now() - def.createdAt;
          if (elapsed < 0 || elapsed > def.duration) return null;

          const cameraHeight =
            viewer?.camera?.positionCartographic?.height || 20000000;
          const scale = Math.max(0.5, 1.5e7 / cameraHeight);

          const t = elapsed / def.duration;
          const idx = Math.floor(t * (def.positions.length - 1));
          const animatedLine = def.positions.slice(0, idx + 1);

          const pulse = Math.sin((t * Math.PI) ** 2) * 0.8 + 0.2;

          return (
            <Entity key={`def-${i}`}>
              <Entity
                polyline={{
                  positions: animatedLine,
                  material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.4,
                    color: def.color.withAlpha(0.9),
                  }),
                  width: 4 * scale,
                }}
              />
              <Entity
                position={Cartesian3.fromDegrees(
                  def.point.lon,
                  def.point.lat,
                  10000
                )}
                ellipse={{
                  semiMajorAxis: 100000 * pulse * scale,
                  semiMinorAxis: 100000 * pulse * scale,
                  material: def.color.withAlpha(0.5),
                }}
              />
              <Entity
                position={Cartesian3.fromDegrees(
                  def.point.lon,
                  def.point.lat,
                  10000
                )}
                point={{
                  pixelSize: 14 * scale,
                  color: def.color.brighten(0.2, new Color()),
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
