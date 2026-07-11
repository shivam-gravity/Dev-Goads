/**
 * Secrets that must never fall back silently once this is actually serving real users.
 * In development/test a placeholder keeps `npm run dev`/tests working without extra setup;
 * in production a missing value throws at import time (before the HTTP server binds to a
 * port) rather than letting every request get signed/verified with a secret that's sitting
 * in the source code.
 */
function requireSecretInProduction(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set in production — refusing to start with a hardcoded fallback secret.`);
  }
  return devFallback;
}

export const JWT_SECRET = requireSecretInProduction("JWT_SECRET", "dev-secret-change-me");
