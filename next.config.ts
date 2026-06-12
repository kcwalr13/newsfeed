import type { NextConfig } from "next";

// Runtime-read data files (fs.readFileSync at request time) that the static
// build tracer can't reliably see. Without these, the Vercel serverless
// bundle may omit them and the pipeline falls back / fails at runtime.
//   - data/sources.json          (lib/pipeline/config.ts loadSources)
//   - data/query_banks*.json     (lib/discovery/queryBank.ts loadQueryBanks;
//                                 only the .default.json ships — query_banks.json
//                                 is a gitignored local artifact)
const tracedDataFiles = ["./data/sources.json", "./data/query_banks*.json"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/pipeline/run": tracedDataFiles,
    "/api/feed/refresh": tracedDataFiles,
  },
};

export default nextConfig;
