import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only deps stay external to the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql", "@prisma/adapter-libsql", "mammoth", "unpdf", "sharp"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
