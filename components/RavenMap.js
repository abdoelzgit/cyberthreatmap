"use client";

import { className } from "cesium";
import { useEffect, useRef } from "react";
import io from "socket.io-client";

export default function RavenMap({
  width = "100%",
  height = "100%",
  className = "",
  style = {},
}) {
  const iframeRef = useRef(null);
  const isInitializedRef = useRef(false);
  const socketRef = useRef(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe && !isInitializedRef.current) {
      isInitializedRef.current = true;

      iframe.addEventListener("load", () => {
        // Check if Raven is already initialized to prevent duplicate script loading
        if (
          iframe.contentWindow.raven &&
          iframe.contentWindow.raven.initialized
        ) {
          console.log("Raven already initialized, skipping...");
          window["raven"] = iframe.contentWindow.raven;
          return;
        }

        // Initialize Raven with custom options (from README)
        const ravenOptions = {
          world_type: null,
          selected_countries: [],
          remove_countries: ["aq"], // Remove Antarctica if desired
          height: window.innerHeight,
          width: window.innerWidth,
          backup_background_color: "transparent", // Set to transparent to erase background
          original_country_color: "#737373",
          clicked_country_color: "#6c4242",
          selected_country_color: "#ff726f",
          attack_output: true,
          global_timeout: 2000,
          global_stats_limit: 10,
          db_length: 100,
          location: "scripts", // Path to scripts folder
          panels: [
            "multi-output",
            "single-output",
            "tooltip",
            "random",
            "insert",
          ], // Removed 'taskbar' to hide the raven panel
          disable: [],
          verbose: true,
        };

        // Access Raven's API via iframe
        window["raven"] = iframe.contentWindow.raven;
        window["raven"].init_all(ravenOptions);
        window["raven"].init_world();

        // Mark as initialized
        iframe.contentWindow.raven.initialized = true;

        // Connect to socket server for real-time data
        const socket = io("http://localhost:4000");

        socket.on("connect", () => {
          console.log("✅ RavenMap connected to socket server");
        });

        socket.on("attack-event", (attackData) => {
          console.log("🚀 RavenMap received attack:", attackData);

          // Convert attack data to Raven format
          // Use coordinates if available, otherwise try city/country, fallback to IP
          let fromLocation, toLocation;

          if (attackData.source.lat && attackData.source.lng) {
            fromLocation = `${attackData.source.lat},${attackData.source.lng}`;
          } else if (
            attackData.source.city &&
            attackData.source.city !== "Unknown"
          ) {
            fromLocation = `${
              attackData.source.city
            },${attackData.source.country.toLowerCase()}`;
          } else {
            fromLocation = attackData.source.ip;
          }

          if (attackData.target.lat && attackData.target.lng) {
            toLocation = `${attackData.target.lat},${attackData.target.lng}`;
          } else if (
            attackData.target.city &&
            attackData.target.city !== "Unknown"
          ) {
            toLocation = `${
              attackData.target.city
            },${attackData.target.country.toLowerCase()}`;
          } else {
            toLocation = attackData.target.ip;
          }

          console.log(`📍 Raven plotting: ${fromLocation} -> ${toLocation}`);

          // Add attack to Raven map with animated line and moving point
          window["raven"].add_to_data_to_table(
            { from: fromLocation, to: toLocation },
            {
              line: {
                from: attackData.color || "#ff726f",
                to: attackData.color || "#ff726f",
              },
              point: {
                color: attackData.color || "#ff726f",
              },
            },
            attackData.attackTravelTimeMs || 5000,
            ["line", "point", "multi-output", "single-output"]
          );
        });

        socket.on("disconnect", () => {
          console.log("❌ RavenMap disconnected from socket server");
        });

        // Store socket reference for cleanup
        socketRef.current = socket;
      });
    }

    // Cleanup function
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (window.ravenSocket) {
        window.ravenSocket.disconnect();
        delete window.ravenSocket;
      }
    };
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src="/raven/raven.html" // Path to copied raven.html
      frameBorder="0"
      width={width}
      height={height}
      scrolling="no" // Disable iframe scrolling to allow map zoom/pan
      style={{ pointerEvents: "auto", overflow: "hidden", ...style }} // Enable pointer events and hide overflow for zoom
      className={className}
    />
  );
}
