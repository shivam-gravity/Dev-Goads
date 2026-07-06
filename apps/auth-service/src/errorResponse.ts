import type { Response } from "express";
import { Prisma } from "@prisma/client";

function isInfraError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    err instanceof Prisma.PrismaClientUnknownRequestError
  );
}

/**
 * Route catch blocks used to do `res.status(400).json({ error: err.message })`
 * unconditionally — fine for errors the service layer throws deliberately
 * ("Invalid email or password"), but it also leaked raw Prisma internals
 * (file paths, schema details) whenever the real failure was a DB/infra
 * problem, and reported that infra problem as a 4xx client error. This
 * distinguishes the two: infra errors are logged server-side and reported as
 * a generic 500; anything else keeps the caller-supplied status and message.
 */
export function sendError(res: Response, err: unknown, status: number, fallback: string): void {
  if (isInfraError(err)) {
    console.error("Infra error surfaced to a route handler", err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  res.status(status).json({ error: err instanceof Error ? err.message : fallback });
}
