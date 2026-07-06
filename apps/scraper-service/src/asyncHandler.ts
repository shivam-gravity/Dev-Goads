import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 doesn't catch rejected promises from async route handlers — an
 * unguarded `await` that throws becomes an unhandled rejection and can crash
 * the process instead of returning a 500. Wrapping every handler here forwards
 * the rejection to Express's error-handling middleware instead.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
