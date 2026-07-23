import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke-test config for apps/web. Runs the app under the Vite DEV server on purpose:
 * in dev (import.meta.env.DEV) the app seeds a demo workspace/business and only needs
 * /auth/me + /workspaces/* to resolve, so the specs can bootstrap auth by mocking those
 * (see tests/e2e/campaign-flow.spec.ts) instead of driving a real login. All backend calls
 * are mocked via page.route(), so no API/LLM/ad-network server is required.
 */
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Smoke tests should fail fast and be deterministic — no implicit retries locally.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Force DEV so the app's no-token demo bootstrap path runs (see AuthContext.tsx).
    // strictPort keeps the port stable so baseURL always matches.
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
