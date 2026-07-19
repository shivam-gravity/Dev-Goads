import { test } from "node:test";
import assert from "node:assert";
import { resolveSearchTask } from "../infra/searchTaskConfig.js";

test("resolveSearchTask - no override anywhere resolves to the SearXNG default", () => {
  const assignment = resolveSearchTask("some-unassigned-task");
  assert.deepStrictEqual(assignment, { provider: "searxng" });
});

test("resolveSearchTask - search-ranking resolves to the SearXNG default (Serper removed)", () => {
  const assignment = resolveSearchTask("search-ranking");
  assert.deepStrictEqual(assignment, { provider: "searxng" });
});

test("resolveSearchTask - a valid env override still resolves (only searxng is valid today)", () => {
  process.env.SEARCH_TASK_WEB_RESEARCH = "searxng";
  try {
    const assignment = resolveSearchTask("web-research");
    assert.deepStrictEqual(assignment, { provider: "searxng" });
  } finally {
    delete process.env.SEARCH_TASK_WEB_RESEARCH;
  }
});

test("resolveSearchTask - an unrecognized provider in the env override is ignored, falls through to default", () => {
  process.env.SEARCH_TASK_SOME_TASK = "tavily";
  try {
    const assignment = resolveSearchTask("some-task");
    assert.deepStrictEqual(assignment, { provider: "searxng" });
  } finally {
    delete process.env.SEARCH_TASK_SOME_TASK;
  }
});
