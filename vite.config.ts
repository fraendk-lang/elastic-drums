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
        manualChunks: {
          // React — stable, rarely changes, long-lived browser cache
          "vendor-react": ["react", "react-dom"],
          // Zustand state library
          "vendor-state": ["zustand"],
          // SoundFont player + MIDI parser — heavy, only needed once user loads soundfonts or MIDI
          "vendor-audio": ["smplr", "@tonejs/midi"],
        },
      },
    },
  },
});
