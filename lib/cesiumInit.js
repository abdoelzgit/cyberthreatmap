// lib/cesiumInit.js
// This file MUST run before any other import from 'cesium' or 'resium'

import * as Cesium from "cesium";

// Read token injected at build/runtime via NEXT_PUBLIC_... (exposed to browser)
const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN || "";

// set default Ion token
if (token) {
  Cesium.Ion.defaultAccessToken = token;
}

// if you copied Cesium static assets to /public/cesium, set base URL:
if (typeof window !== "undefined") {
  // e.g. NEXT_PUBLIC_CESIUM_BASE_URL="/cesium"
  const base = process.env.NEXT_PUBLIC_CESIUM_BASE_URL || "/cesium";
  // instruct Cesium where to load workers and assets from
  window.CESIUM_BASE_URL = base;
}

export default Cesium;
