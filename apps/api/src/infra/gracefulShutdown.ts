import type { Worker } from "bullmq";
import { logger } from "../modules/logger/logger.js";

const SHUTDOWN_FORCE_EXIT_MS = 30_000; // workers' jobs run far longer than a request

/**
 * Wires SIGTERM/SIGINT to `worker.close()` — BullMQ waits for the currently-active job
 * (if any) to finish before resolving, so a deploy/restart doesn't cut off, e.g., a
 * campaign-generation run mid-way through billed API calls it can't safely resume from
 * where it left off. A second signal, or the timeout, forces the process down instead of
 * hanging forever on one stuck job. One call per worker process (each has exactly one
 * Worker instance), called right after constructing it.
 */
export function registerGracefulShutdown(worker: Worker, label: string): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      logger.warn(`${label}: received ${signal} again during shutdown — forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`${label}: received ${signal} — waiting for the active job to finish (up to ${SHUTDOWN_FORCE_EXIT_MS}ms)`);

    const forceExit = setTimeout(() => {
      logger.error(`${label}: graceful shutdown timed out after ${SHUTDOWN_FORCE_EXIT_MS}ms — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_FORCE_EXIT_MS);
    forceExit.unref();

    worker
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error(`${label}: error while closing worker`, err);
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
