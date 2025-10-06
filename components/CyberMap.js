"use client";

import { useEffect, useRef, useState } from "react";

import { Viewer, Entity } from "resium";
import {
  Cartesian3,
  Color,
  Cartographic,
  EllipsoidGeodesic,
  CallbackProperty,
  JulianDate,
} from "cesium";
import io from "socket.io-client";
import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";

import { Button } from "@/components/ui/button"; // pastikan path benar
import ThreatLogCard from "./LogCard";
Cesium.Ion.defaultAccessToken =
  process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "YOUR_ACCESS_TOKEN_HERE";

/** helper: geodesic positions */
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

export default function GlobeSocketMap() {
  const viewerRef = useRef(null);
  const socketRef = useRef(null);
  const routesRef = useRef(new Map());
  const initCamRef = useRef(false);

  const [, setTick] = useState(0);

  // initial camera fly
  useEffect(() => {
    const tryFly = () => {
      if (viewerRef.current && !initCamRef.current) {
        const cesiumViewer = viewerRef.current.cesiumElement;
        cesiumViewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(0, 20, 20000000),
          duration: 1.2,
        });
        initCamRef.current = true;
      }
    };
    setTimeout(tryFly, 300);
  }, []);

  // socket listener
  useEffect(() => {
    socketRef.current = io("http://localhost:4000");

    socketRef.current.on("connect", () => {
      console.log("connected to socket server", socketRef.current.id);
    });

    const levelColors = {
      Low: Color.GREEN,
      Medium: Color.ORANGE,
      High: Color.RED,
      Critical: Color.PURPLE,
    };

    socketRef.current.on("attack-event", (e) => {
      const lonA = e.source.lng;
      const latA = e.source.lat;
      const lonB = e.target.lng;
      const latB = e.target.lat;

      const positions = geodesicPositions(lonA, latA, lonB, latB, 160);
      const now = Date.now();
      const duration = 3000;

      // ✅ parse color aman
      let color;
      try {
        color = e.color ? Color.fromCssColorString(e.color) : Color.ORANGE;
      } catch {
        color = Color.ORANGE;
      }

      routesRef.current.set(e.id, {
        id: e.id,
        positions,
        createdAt: now,
        duration,
        color,
        source: { lon: lonA, lat: latA },
        target: { lon: lonB, lat: latB }, // ✅ fixed
        threatLevel: e.threatLevel,
        attackType: e.attackType,
      });

      setTick(Date.now());
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.off("attack-event");
        socketRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {/* Overlay Button */}
      <div className="absolute top-4  left-4 z-50">
        <ThreatLogCard />
      </div>

      {/* Globe Viewer */}
      <Viewer full ref={viewerRef} timeline={false} animation={false}>
        {Array.from(routesRef.current.values()).map((route) => {
          const polyPositions = route.positions;
          if (!polyPositions || polyPositions.length === 0) return null;

          const start = route.createdAt;
          const dur = route.duration;
          const positionsCount = polyPositions.length;

          const movingPosition = new CallbackProperty((time) => {
            const elapsed = JulianDate.toDate(time).getTime() - start;
            const t = (elapsed % dur) / dur;
            const idx = Math.floor(t * (positionsCount - 1));
            return polyPositions[idx];
          }, false);

          const animatedLine = new CallbackProperty(() => {
            const now = Date.now();
            const elapsed = now - start;
            const t = (elapsed % dur) / dur;
            const idx = Math.floor(t * (positionsCount - 1));
            const arr = [];
            for (let i = 0; i <= idx; i++) {
              arr.push(polyPositions[i]);
            }
            return arr;
          }, false);

          const srcCart = Cartesian3.fromDegrees(
            route.source.lon,
            route.source.lat,
            10000
          );
          const dstCart = Cartesian3.fromDegrees(
            route.target.lon,
            route.target.lat,
            10000
          );

          return (
            <Entity key={route.id}>
              <Entity
                polyline={{
                  positions: animatedLine,
                  material: route.color.withAlpha(1.0),
                  width: 2,
                  clampToGround: false,
                }}
              />
              <Entity
                position={movingPosition}
                point={{
                  pixelSize: 10,
                  color: route.color,
                  outlineColor: Color.WHITE,
                  outlineWidth: 5,
                }}
              />
              <Entity
                position={srcCart}
                point={{
                  pixelSize: 8,
                  color: route.color,
                  outlineColor: Color.WHITE,
                  outlineWidth: 1,
                }}
              />
              <Entity
                position={dstCart}
                point={{
                  pixelSize: 8,
                  color: route.color,
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
