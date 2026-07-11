import * as Sentry from "@sentry/node";

const SENTRY_DSN = process.env.SENTRY_DSN;
let initialized = false;

// Deliberately uses console, not apps/api's modules/logger/logger.js — this file is
// shared verbatim across all 4 services (some of which just use console directly and
// don't otherwise depend on apps/api's logger module), so it stays reusable without
// pulling that dependency chain into services that don't already have it.

/**
 * Same "degrade to a no-op with zero network calls when unconfigured" contract as every
 * other integration in this codebase (OpenAI, ad-network adapters, ...) — a production
 * deploy without SENTRY_DSN set keeps working exactly as before, it just has no crash
 * reporting. Call once, as early as possible in each service's entrypoint (before other
 * imports that could themselves throw during module init).
 */
export function initErrorTracking(serviceName: string): void {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    serverName: serviceName,
    tracesSampleRate: 0,
  });
  initialized = true;
  console.log(`Error tracking initialized for ${serviceName}`);
}

/**
 * Reports an error to Sentry (if configured) and always logs it locally too — Sentry
 * being down/unconfigured must never be the reason an error goes completely unlogged.
 * Use this from Express error-handling middleware and process-level crash handlers,
 * not from routine per-request try/catch (those already have their own user-facing
 * error responses; this is for "something we didn't expect happened").
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  console.error(err, context ?? "");
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Registers process-level safety nets so a truly uncaught error is reported before the
 * process (potentially) exits, instead of only ever showing up in stdout. */
export function registerCrashReporting(serviceName: string): void {
  process.on("uncaughtException", (err) => {
    captureError(err, { service: serviceName, kind: "uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    captureError(reason, { service: serviceName, kind: "unhandledRejection" });
  });
}
