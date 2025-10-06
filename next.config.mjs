import CopyPlugin from "copy-webpack-plugin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: path.join(
                __dirname,
                "node_modules/cesium/Build/Cesium"
              ),
              to: path.join(__dirname, "public/cesium"),
            },
          ],
        })
      );
    }
    return config;
  },
};

export default nextConfig;
