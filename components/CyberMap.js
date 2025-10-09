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
import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import ThreatLogCard from "./LogCard";

Cesium.Ion.defaultAccessToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "";

/** 🔹 Membuat garis lurus antar dua titik */
function straightLinePositions(lon1, lat1, lon2, lat2, segments = 128) {
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(lon1, lat1),
    Cesium.Cartographic.fromDegrees(lon2, lat2)
  );

  const positions = [];
  for (let i = 0; i <= segments; i++) {
    const frac = i / segments;
    const carto = geodesic.interpolateUsingFraction(frac);
    // Sedikit ketinggian biar garisnya tidak menempel ke bumi
    const height = 200 + Math.sin(Math.PI * frac) * 200000; 
    const pos = Cartesian3.fromRadians(
      carto.longitude,
      carto.latitude,
      height
    );
    positions.push(pos);
  }
  return positions;
}


export default function GlobeSocketMap() {
  const viewerRef = useRef(null);
  const socketRef = useRef(null);
  const routesRef = useRef(new Map());
  const explosionsRef = useRef(new Map());
  const centersRef = useRef([]);
  const initialFlyDoneRef = useRef(false);
  const [, setTick] = useState(0);

  /** 🎥 Kamera awal */
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

    socketRef.current.on("center-info", (data) => {
      if (data?.centers) centersRef.current = data.centers;

      if (!initialFlyDoneRef.current && centersRef.current.length > 0) {
        const viewer = viewerRef.current?.cesiumElement;
        const first = centersRef.current[0];
        if (viewer) {
          viewer.camera.flyTo({
            destination: Cartesian3.fromDegrees(first.lng, first.lat, 800000),
            duration: 2.0,
            easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
          });
          initialFlyDoneRef.current = true;
        }
      }
      setTick(Date.now());
    });

    /** 🚀 Saat serangan terjadi */
    socketRef.current.on("attack-event", (e) => {
      const lonA = e.source.lng;
      const latA = e.source.lat;
      const now = Date.now();
      const duration = 4000;

      const levelColors = {
        Low: "#FFEB3B",
        Medium: "#FFEB3B",
        High: "#FFEB3B",
        Critical: "#FFEB3B",
      };
      const attackColor = Color.fromCssColorString(
        levelColors[e.threatLevel] || "#FFFFFF"
      );

      e.targets.forEach((t, i) => {
        const lonB = t.lng;
        const latB = t.lat;
        const positions = straightLinePositions(lonA, latA, lonB, latB, 128);
        const routeKey = `${e.id}-${i}-${now}`;

        routesRef.current.set(routeKey, {
          id: routeKey,
          positions,
          createdAt: now,
          duration,
          color: attackColor,
          accepted: t.accepted,
          source: { lon: lonA, lat: latA },
          target: { lon: lonB, lat: latB },
        });

        explosionsRef.current.set(`${routeKey}-explosion`, {
          point: { lng: lonB, lat: latB },
          color: t.accepted ? Color.LIME : Color.RED,
          createdAt: now + duration,
        });
      });

      setTick(Date.now());
    });

    return () => {
      socketRef.current?.disconnect();
      routesRef.current.clear();
      explosionsRef.current.clear();
      centersRef.current = [];
    };
  }, []);

  /** 🧹 Auto cleanup */
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, route] of routesRef.current.entries()) {
        if (now - route.createdAt > route.duration + 2500) {
          routesRef.current.delete(key);
        }
      }
      for (const [key, exp] of explosionsRef.current.entries()) {
        if (now - exp.createdAt > 1500) explosionsRef.current.delete(key);
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
        {/* --- CENTER POINTS --- */}
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

        {/* 🔶 GARIS SERANGAN (animasi + transisi warna hasil) */}
        {Array.from(routesRef.current.values()).map((route) => {
          const { id, positions, createdAt, duration, color, accepted } = route;
          if (!positions?.length) return null;

          const animatedLine = new CallbackProperty(() => {
            const elapsed = Date.now() - createdAt;
            const t = Math.min(elapsed / duration, 1);
            const idx = Math.floor(t * (positions.length - 1));
            return positions.slice(0, idx + 1);
          }, false);

          const animatedColor = new CallbackProperty(() => {
            const elapsed = Date.now() - createdAt;
            const t = Math.min(elapsed / duration, 1);
            const baseColor = color;

            // Setelah animasi selesai, ubah warna jadi hasil (fade)
            if (t >= 1 && accepted !== null && accepted !== undefined) {
              const resultColor = accepted ? Color.LIME : Color.RED;
              const fadeDuration = 2000;
              const fadeProgress = Math.min(
                1,
                (elapsed - duration) / fadeDuration
              );
              const lerped = Cesium.Color.lerp(
                baseColor,
                resultColor,
                fadeProgress,
                new Cesium.Color()
              );
              return lerped.withAlpha(1 - fadeProgress * 0.2);
            }

            return baseColor;
          }, false);

          const material = new PolylineGlowMaterialProperty({
            glowPower: 0.3,
            color: animatedColor,
          });

          return (
            <Entity
              key={id}
              polyline={{
                positions: animatedLine,
                width: 6,
                material,
              }}
            />
          );
        })}

        {/* 💥 Explosion efek */}
        {Array.from(explosionsRef.current.values()).map((exp, i) => {
          const viewer = viewerRef.current?.cesiumElement;
          const elapsed = Date.now() - exp.createdAt;
          if (elapsed > 2000 || elapsed < 0) return null;

          const cameraHeight =
            viewer?.camera?.positionCartographic?.height || 20000000;
          const scale = Math.max(0.5, 1.5e7 / cameraHeight);

          const radius = (150000 + (elapsed / 2000) * 400000) * scale;
          const alpha = 1 - elapsed / 2000;

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
      </Viewer>
    </div>
  );
}
