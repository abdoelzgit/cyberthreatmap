'use client'
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";

const CyberMap = dynamic(() => import("../components/CyberMap"), { ssr: false });
const RavenMap = dynamic(() => import("../components/RavenMap"), { ssr: false });

export default function Home() {
  const [mapType, setMapType] = useState('cyber'); // 'cyber' or 'raven'
  const [isLoading, setIsLoading] = useState(false);

  // Handle map switching with loading state
  const handleMapSwitch = (newMapType) => {
    if (newMapType !== mapType) {
      setIsLoading(true);
      // Small delay to show loading state
      setTimeout(() => {
        setMapType(newMapType);
        setIsLoading(false);
      }, 200);
    }
  };

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {/* Toggle Buttons */}
      <div style={{
        position: "absolute",
        top: "10px",
        left: "10px",
        zIndex: 1000,
        display: "flex",
        gap: "10px"
      }}>
        <Button
          onClick={() => handleMapSwitch('cyber')}
          variant={mapType === 'cyber' ? 'default' : 'outline'}
          disabled={isLoading}
        >
          Cyber Map (3D)
        </Button>
        <Button
          onClick={() => handleMapSwitch('raven')}
          variant={mapType === 'raven' ? 'default' : 'outline'}
          disabled={isLoading}
        >
          Raven Map (2D)
        </Button>
        {isLoading && <span style={{ alignSelf: "center", color: "#666" }}>Switching...</span>}
      </div>

      {/* Render Selected Map with key to force re-mount */}
      {mapType === 'cyber' && <CyberMap key="cyber" />}
      {mapType === 'raven' && <RavenMap key="raven" />}
    </div>
  );
}
