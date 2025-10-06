"use client";
import { useEffect } from "react";

export default function ClientCesiumConfig() {
  useEffect(() => {
    window.CESIUM_BASE_URL = "/cesium";
  }, []);
  return null;
}
