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
      // Real-time WebSocket (campaign progress, live insights). The frontend connects to
      // ws://<vite-host>/ws (useRealtime.ts), but the WS server lives on the gateway (:4000, path
      // "/ws" — websocketServer.ts). Without `ws: true` here, Vite doesn't forward the upgrade
      // request and the handshake TIMES OUT — which killed all live progress streaming (the
      // "WebSocket opening handshake timed out" console errors, and why campaign generation
      // appeared to hang/not update). Proxying the upgrade to :4000 restores the live stream.
      "/ws": { target: "ws://localhost:4000", ws: true },
      // Serves blobs written by LocalFileObjectStorage (apps/api/src/infra/objectStorage.ts) —
      // Asset/Creative URLs are relative ("/objects/...") since the API doesn't know its own
      // public origin; proxying here keeps them resolvable in dev without hardcoding a host.
      "/objects": "http://localhost:4000",
    },
  },
});
