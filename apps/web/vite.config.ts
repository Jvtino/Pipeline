import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy sends /api/* to the Fastify API on :3001, so the web app calls a
// same-origin path in dev and prod alike (no CORS, no hardcoded host).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/auth": "http://localhost:3001",
    },
  },
});
