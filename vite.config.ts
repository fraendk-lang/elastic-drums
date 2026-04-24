import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // COOP/COEP headers needed for SharedArrayBuffer (enable when WASM is ready)
    // headers: {
    //   "Cross-Origin-Opener-Policy": "same-origin",
    //   "Cross-Origin-Embedder-Policy": "require-corp",
    // },
  },
  base: "./",  // Relative paths for plugin WebView resource provider
  build: {
    target: "esnext",
    // Warn on any chunk > 1MB so we don't silently ship huge bundles
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── Vendor splits ─────────────────────────────────────
          // React — stable, rarely changes, long-lived browser cache
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          // Zustand state library
          if (id.includes("node_modules/zustand")) {
            return "vendor-state";
          }
          // SoundFont player + MIDI parser — heavy, only needed once user loads soundfonts or MIDI
          if (id.includes("node_modules/smplr") || id.includes("node_modules/@tonejs")) {
            return "vendor-audio";
          }

          // ── App splits ────────────────────────────────────────
          // Sample library catalog — 400KB, lazy-loaded via SampleBrowser
          if (id.includes("SampleLibrary")) {
            return "chunk-sample-library";
          }
          // Audio engines — large DSP modules, shared across all tabs
          if (id.includes("/src/audio/")) {
            return "chunk-audio";
          }
          // Zustand stores — separate from engines, change more often
          if (id.includes("/src/store/")) {
            return "chunk-stores";
          }
          // Factory kit data — static JSON-like data
          if (id.includes("/src/kits/")) {
            return "chunk-kits";
          }
        },
      },
    },
  },
});
