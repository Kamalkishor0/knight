import type { NextConfig } from "next";
import { dirname } from "path";
import { fileURLToPath } from "url";

const clientRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: clientRoot,
  },
};

export default nextConfig;
