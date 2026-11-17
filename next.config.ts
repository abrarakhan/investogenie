import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": [
      ".venv/**/*",
      ".next/**/*",
      "node_modules/**/*",
      "data/**/*",
      "**/__pycache__/**/*",
      "**/.pycache_tmp/**/*",
      "**/*.pyc",
    ],
  },
  experimental: {
    agentUpgrade: "security",
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
