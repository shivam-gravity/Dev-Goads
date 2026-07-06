import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      // Serves blobs written by LocalFileObjectStorage (apps/api/src/infra/objectStorage.ts) —
      // Asset/Creative URLs are relative ("/objects/...") since the API doesn't know its own
      // public origin; proxying here keeps them resolvable in dev without hardcoding a host.
      "/objects": "http://localhost:4000",
    },
  },
});
