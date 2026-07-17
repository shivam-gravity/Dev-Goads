import type { ResearchJobStatus } from "../types/index.js";

/** Thrown when the orchestrator (or a bug) attempts an illegal status transition —
 * kept as its own error class so callers can distinguish "job genuinely failed" from
 * "the orchestration code has a sequencing bug", which should never be silently swallowed. */
export class InvalidResearchJobTransitionError extends Error {
  constructor(from: ResearchJobStatus, to: ResearchJobStatus) {
    super(`Invalid research job transition: ${from} -> ${to}`);
    this.name = "InvalidResearchJobTransitionError";
  }
}

/**
 * pending -> running -> aggregating -> completed
 *                  \-------> failed <-------/
 *
 * Every non-terminal state can also fail (a provider set can blow up, aggregation/
 * validation can throw) — `failed` and `completed` are terminal, matching the DB
 * column's status semantics (ResearchJob.status) 1:1, so persisting a transition is
 * just writing `.state` back to that column.
 */
const TRANSITIONS: Record<ResearchJobStatus, ResearchJobStatus[]> = {
  pending: ["running", "failed"],
  running: ["aggregating", "failed"],
  aggregating: ["completed", "failed"],
  completed: [],
  failed: [],
};

export class ResearchJobStateMachine {
  private current: ResearchJobStatus;

  constructor(initial: ResearchJobStatus = "pending") {
    this.current = initial;
  }

  get state(): ResearchJobStatus {
    return this.current;
  }

  get isTerminal(): boolean {
    return TRANSITIONS[this.current].length === 0;
  }

  canTransitionTo(next: ResearchJobStatus): boolean {
    return TRANSITIONS[this.current].includes(next);
  }

  transition(next: ResearchJobStatus): ResearchJobStatus {
    if (!this.canTransitionTo(next)) {
      throw new InvalidResearchJobTransitionError(this.current, next);
    }
    this.current = next;
    return this.current;
  }
}
