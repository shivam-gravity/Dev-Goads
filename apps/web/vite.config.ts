import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Pin to 5173 and fail loudly if it's taken, rather than silently drifting to 5174/5175.
    // OAuth callbacks and WEB_APP_URL assume 5173, so a drifted port breaks those flows — a
    // hard error tells you to kill the stale dev server instead of quietly landing elsewhere.
    strictPort: true,
    proxy: {
      "/api": "http://localhost:4000",
      // Serves blobs written by LocalFileObjectStorage (apps/api/src/infra/objectStorage.ts) —
      // Asset/Creative URLs are relative ("/objects/...") since the API doesn't know its own
      // public origin; proxying here keeps them resolvable in dev without hardcoding a host.
      "/objects": "http://localhost:4000",
    },
  },
});
