import { test } from "node:test";
import assert from "node:assert";
import { ResearchJobStateMachine, InvalidResearchJobTransitionError } from "../research/state-machine/ResearchJobStateMachine.js";

test("ResearchJobStateMachine - walks the happy path pending -> running -> aggregating -> completed", () => {
  const machine = new ResearchJobStateMachine("pending");
  assert.strictEqual(machine.state, "pending");
  assert.strictEqual(machine.isTerminal, false);

  machine.transition("running");
  assert.strictEqual(machine.state, "running");

  machine.transition("aggregating");
  assert.strictEqual(machine.state, "aggregating");

  machine.transition("completed");
  assert.strictEqual(machine.state, "completed");
  assert.strictEqual(machine.isTerminal, true);
});

test("ResearchJobStateMachine - any non-terminal state can transition to failed", () => {
  for (const start of ["pending", "running", "aggregating"] as const) {
    const machine = new ResearchJobStateMachine(start);
    assert.strictEqual(machine.canTransitionTo("failed"), true);
    machine.transition("failed");
    assert.strictEqual(machine.state, "failed");
    assert.strictEqual(machine.isTerminal, true);
  }
});

test("ResearchJobStateMachine - rejects illegal transitions (e.g. skipping straight to completed, or leaving a terminal state)", () => {
  const machine = new ResearchJobStateMachine("pending");
  assert.strictEqual(machine.canTransitionTo("completed"), false);
  assert.throws(() => machine.transition("completed"), InvalidResearchJobTransitionError);

  const terminal = new ResearchJobStateMachine("completed");
  assert.throws(() => terminal.transition("running"), InvalidResearchJobTransitionError);

  const failedMachine = new ResearchJobStateMachine("failed");
  assert.throws(() => failedMachine.transition("running"), InvalidResearchJobTransitionError);
});
