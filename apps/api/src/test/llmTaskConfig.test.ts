import { test } from "node:test";
import assert from "node:assert";
import { resolveTaskModel } from "../infra/llmTaskConfig.js";

const BEDROCK_DEFAULT = { provider: "bedrock", model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0" };

test("resolveTaskModel - no override anywhere resolves to the Bedrock default", () => {
  const assignment = resolveTaskModel("some-unassigned-task");
  assert.deepStrictEqual(assignment, BEDROCK_DEFAULT);
});

test("resolveTaskModel - a valid env override wins over the default", () => {
  process.env.LLM_TASK_TEST_AGENT = "bedrock:us.anthropic.claude-opus-4-1-20250805-v1:0";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, { provider: "bedrock", model: "us.anthropic.claude-opus-4-1-20250805-v1:0" });
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});

test("resolveTaskModel - env override preserves colons in the model name (Bedrock ids like ...-v1:0)", () => {
  process.env.LLM_TASK_TEST_AGENT = "bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, { provider: "bedrock", model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0" });
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});

test("resolveTaskModel - task name hyphens map to underscores in the env var key, and wins over that task's own static registry entry", () => {
  process.env.LLM_TASK_BUDGET_AGENT = "bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0";
  try {
    const assignment = resolveTaskModel("budget-agent");
    assert.deepStrictEqual(assignment, { provider: "bedrock", model: "us.anthropic.claude-haiku-4-5-20251001-v1:0" });
  } finally {
    delete process.env.LLM_TASK_BUDGET_AGENT;
  }
});

test("resolveTaskModel - an unrecognized provider in the env override is ignored, falls through to default", () => {
  process.env.LLM_TASK_TEST_AGENT = "bogus-provider:some-model";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, BEDROCK_DEFAULT);
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});

test("resolveTaskModel - a now-removed provider (mistral/openrouter/ollama/google) in the env override is ignored", () => {
  for (const removed of ["mistral:mistral-small-latest", "openrouter:foo", "ollama:llama3.1:8b", "google:gemini-2.0-flash"]) {
    process.env.LLM_TASK_TEST_AGENT = removed;
    try {
      assert.deepStrictEqual(resolveTaskModel("test-agent"), BEDROCK_DEFAULT);
    } finally {
      delete process.env.LLM_TASK_TEST_AGENT;
    }
  }
});

test("resolveTaskModel - a malformed env override (no colon at all) is ignored, falls through to default", () => {
  process.env.LLM_TASK_TEST_AGENT = "bedrock-no-separator";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, BEDROCK_DEFAULT);
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});

test("resolveTaskModel - an env override with an empty model name is ignored, falls through to default", () => {
  process.env.LLM_TASK_TEST_AGENT = "bedrock:";
  try {
    const assignment = resolveTaskModel("test-agent");
    assert.deepStrictEqual(assignment, BEDROCK_DEFAULT);
  } finally {
    delete process.env.LLM_TASK_TEST_AGENT;
  }
});
