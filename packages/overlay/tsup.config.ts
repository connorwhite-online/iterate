import { defineConfig } from "tsup";

export default defineConfig([
  // Library build — ESM, React external (for npm consumers)
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    external: ["react", "react-dom"],
    clean: true,
  },
  // Standalone build — IIFE, React bundled (served by daemon)
  {
    entry: { standalone: "src/standalone.tsx" },
    format: ["iife"],
    platform: "browser",
    // Bundle everything — React, ReactDOM, core types
    noExternal: [/.*/],
    minify: true,
    clean: false, // don't wipe the library build
  },
]);
