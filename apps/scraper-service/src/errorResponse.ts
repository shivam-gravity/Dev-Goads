import type { Response } from "express";

export function sendError(res: Response, err: unknown, status: number, fallback: string): void {
  res.status(status).json({ error: err instanceof Error ? err.message : fallback });
}
