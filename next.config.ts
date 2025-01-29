import type { NextConfig } from "next";
import axios from "axios";

let isFirstRun = true;

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer && isFirstRun) {
      axios.get("http://localhost:3000/api/checkPlayerId");
      axios.get("http://localhost:3000/api/vlc");
      isFirstRun = false;
    }
    return config;
  },
};

export default nextConfig;
