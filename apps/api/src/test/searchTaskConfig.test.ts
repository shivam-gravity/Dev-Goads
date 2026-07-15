import { test } from "node:test";
import assert from "node:assert";
import { resolveSearchTask } from "../infra/searchTaskConfig.js";

test("resolveSearchTask - no override anywhere resolves to the Tavily default", () => {
  const assignment = resolveSearchTask("some-unassigned-task");
  assert.deepStrictEqual(assignment, { provider: "tavily" });
});

test("resolveSearchTask - search-ranking's static registry entry resolves to serper", () => {
  const assignment = resolveSearchTask("search-ranking");
  assert.deepStrictEqual(assignment, { provider: "serper" });
});

test("resolveSearchTask - a valid env override wins over the static registry", () => {
  process.env.SEARCH_TASK_SEARCH_RANKING = "searxng";
  try {
    const assignment = resolveSearchTask("search-ranking");
    assert.deepStrictEqual(assignment, { provider: "searxng" });
  } finally {
    delete process.env.SEARCH_TASK_SEARCH_RANKING;
  }
});

test("resolveSearchTask - task name hyphens map to underscores in the env var key", () => {
  process.env.SEARCH_TASK_WEB_RESEARCH = "serper";
  try {
    const assignment = resolveSearchTask("web-research");
    assert.deepStrictEqual(assignment, { provider: "serper" });
  } finally {
    delete process.env.SEARCH_TASK_WEB_RESEARCH;
  }
});

test("resolveSearchTask - an unrecognized provider in the env override is ignored, falls through to default", () => {
  process.env.SEARCH_TASK_SOME_TASK = "bing";
  try {
    const assignment = resolveSearchTask("some-task");
    assert.deepStrictEqual(assignment, { provider: "tavily" });
  } finally {
    delete process.env.SEARCH_TASK_SOME_TASK;
  }
});
