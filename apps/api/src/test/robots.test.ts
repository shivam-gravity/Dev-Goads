import { test } from "node:test";
import assert from "node:assert";
import { ALLOW_ALL, isPathAllowed, parseRobots } from "../modules/onboarding/robots.js";

test("robots - no rules means everything is allowed", () => {
  assert.strictEqual(isPathAllowed(ALLOW_ALL, "/anything"), true);
  assert.strictEqual(isPathAllowed(parseRobots(""), "/anything"), true);
});

test("robots - honors Disallow prefixes for the wildcard agent", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /admin\nDisallow: /private/");
  assert.strictEqual(isPathAllowed(rules, "/admin"), false);
  assert.strictEqual(isPathAllowed(rules, "/admin/settings"), false);
  assert.strictEqual(isPathAllowed(rules, "/private/x"), false);
  assert.strictEqual(isPathAllowed(rules, "/pricing"), true);
});

test("robots - a group naming our bot overrides the wildcard group entirely", () => {
  const rules = parseRobots(
    "User-agent: *\nDisallow: /\n\nUser-agent: AdGoOnboardingBot\nDisallow: /admin"
  );
  assert.strictEqual(isPathAllowed(rules, "/pricing"), true, "the * group's Disallow: / must not apply to our named group");
  assert.strictEqual(isPathAllowed(rules, "/admin"), false);
});

test("robots - longest match wins and Allow beats Disallow on ties", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /shop\nAllow: /shop/public");
  assert.strictEqual(isPathAllowed(rules, "/shop/checkout"), false);
  assert.strictEqual(isPathAllowed(rules, "/shop/public/catalog"), true, "the longer Allow rule must win");
});

test("robots - supports * wildcards and $ end anchors in paths", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*/draft");
  assert.strictEqual(isPathAllowed(rules, "/files/report.pdf"), false);
  assert.strictEqual(isPathAllowed(rules, "/files/report.pdf.html"), true, "$ must anchor to the end");
  assert.strictEqual(isPathAllowed(rules, "/tmp/a/draft"), false);
  assert.strictEqual(isPathAllowed(rules, "/tmp/a/final"), true);
});

test("robots - parses Crawl-delay in seconds, capped at 2000ms", () => {
  assert.strictEqual(parseRobots("User-agent: *\nCrawl-delay: 1").crawlDelayMs, 1000);
  assert.strictEqual(parseRobots("User-agent: *\nCrawl-delay: 30").crawlDelayMs, 2000, "a 30s ask would blow the crawl budget — capped");
  assert.strictEqual(parseRobots("User-agent: *\nDisallow: /x").crawlDelayMs, null);
});

test("robots - comments and blank lines are ignored, multiple agents share a group", () => {
  const rules = parseRobots(
    "# global rules\nUser-agent: googlebot\nUser-agent: *\n\nDisallow: /secret # hidden\n"
  );
  assert.strictEqual(isPathAllowed(rules, "/secret"), false);
  assert.strictEqual(isPathAllowed(rules, "/open"), true);
});
