import { test } from "node:test";
import assert from "node:assert";
import { resolveTaskModel } from "../infra/llmTaskConfig.js";

test("resolveTaskModel - no override anywhere resolves to the OpenAI default", () => {
  const assignment = resolveTaskModel("some-unassigned-task");
  assert.deepStrictEqual(assignment, { provider: "openai", model: "gpt-4o" });
});

test("resolveTaskModel - a valid env override wins over the default", () => {
  process.env.LLM_TASK_TEST_AGENT = "ollama:llama3.1:8b";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, { provider: "ollama", model: "llama3.1:8b" });
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});

test("resolveTaskModel - env override preserves colons in the model name (Ollama tags like llama3.1:8b)", () => {
  process.env.LLM_TASK_TEST_AGENT = "ollama:qwen2.5-coder:7b";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, { provider: "ollama", model: "qwen2.5-coder:7b" });
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});

test("resolveTaskModel - task name hyphens map to underscores in the env var key", () => {
  process.env.LLM_TASK_BUDGET_AGENT = "anthropic:claude-sonnet-5";
  try {
    const assignment = resolveTaskModel("budget-agent");
    assert.deepStrictEqual(assignment, { provider: "anthropic", model: "claude-sonnet-5" });
  } finally {
    delete process.env.LLM_TASK_BUDGET_AGENT;
  }
});

test("resolveTaskModel - an unrecognized provider in the env override is ignored, falls through to default", () => {
  process.env.LLM_TASK_TEST_AGENT = "bogus-provider:some-model";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, { provider: "openai", model: "gpt-4o" });
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});

test("resolveTaskModel - a malformed env override (no colon at all) is ignored, falls through to default", () => {
  process.env.LLM_TASK_TEST_AGENT = "ollama-no-separator";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, { provider: "openai", model: "gpt-4o" });
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});

test("resolveTaskModel - an env override with an empty model name is ignored, falls through to default", () => {
  process.env.LLM_TASK_TEST_AGENT = "ollama:";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, { provider: "openai", model: "gpt-4o" });
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});
