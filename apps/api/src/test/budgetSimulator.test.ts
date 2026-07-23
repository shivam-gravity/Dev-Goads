import { test } from "node:test";
import assert from "node:assert";
import { simulateBudget } from "../modules/adapters/budgetSimulator.js";

const BUDGET = 3500; // $35/day in cents

test("simulateBudget - scales impressions with budget (more budget → more impressions)", () => {
  const low = simulateBudget({ objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 1000, platforms: ["meta"] });
  const high = simulateBudget({ objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 10000, platforms: ["meta"] });
  assert.ok(high.estImpressionsPerDay > low.estImpressionsPerDay);
});

test("simulateBudget - platform mix genuinely changes impressions (Google ≠ Meta ≠ both)", () => {
  const meta = simulateBudget({ objective: "OUTCOME_SALES", dailyBudgetCents: BUDGET, platforms: ["meta"] });
  const google = simulateBudget({ objective: "OUTCOME_SALES", dailyBudgetCents: BUDGET, platforms: ["google"] });
  const both = simulateBudget({ objective: "OUTCOME_SALES", dailyBudgetCents: BUDGET, platforms: ["meta", "google"] });

  // Meta buys cheaper, broader reach → more impressions than pricier Google.
  assert.ok(meta.estImpressionsPerDay > google.estImpressionsPerDay, "Meta should yield more impressions than Google at equal budget");
  // Both-platforms blends strictly between the two single-platform extremes.
  assert.ok(
    both.estImpressionsPerDay < meta.estImpressionsPerDay && both.estImpressionsPerDay > google.estImpressionsPerDay,
    "combined preview should sit between the two single-platform values"
  );
});

test("simulateBudget - Google's intent-driven clicks convert to higher ROAS than Meta (at a budget where rounding doesn't flatten it)", () => {
  // Uses a larger budget so estConversions isn't rounded to the same small integer for both — at
  // $35/day both round to ~2 conversions and the ROAS difference is invisible; at $500/day the
  // richer Google conversion rate shows through.
  const meta = simulateBudget({ objective: "OUTCOME_SALES", dailyBudgetCents: 50000, platforms: ["meta"] });
  const google = simulateBudget({ objective: "OUTCOME_SALES", dailyBudgetCents: 50000, platforms: ["google"] });
  assert.ok(google.estRoas > meta.estRoas, `Google ROAS (${google.estRoas}) should beat Meta (${meta.estRoas})`);
});

test("simulateBudget - empty/omitted platforms defaults to Meta-only (the current launch default)", () => {
  const omitted = simulateBudget({ objective: "OUTCOME_LEADS", dailyBudgetCents: BUDGET });
  const empty = simulateBudget({ objective: "OUTCOME_LEADS", dailyBudgetCents: BUDGET, platforms: [] });
  const meta = simulateBudget({ objective: "OUTCOME_LEADS", dailyBudgetCents: BUDGET, platforms: ["meta"] });
  assert.deepStrictEqual(omitted, meta);
  assert.deepStrictEqual(empty, meta);
});

test("simulateBudget - objective still matters (awareness buys more impressions than sales at equal budget)", () => {
  const awareness = simulateBudget({ objective: "OUTCOME_AWARENESS", dailyBudgetCents: BUDGET, platforms: ["meta"] });
  const sales = simulateBudget({ objective: "OUTCOME_SALES", dailyBudgetCents: BUDGET, platforms: ["meta"] });
  assert.ok(awareness.estImpressionsPerDay > sales.estImpressionsPerDay);
});

test("simulateBudget - zero budget yields zeros, never NaN/Infinity", () => {
  const sim = simulateBudget({ objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 0, platforms: ["meta", "google"] });
  assert.strictEqual(sim.estImpressionsPerDay, 0);
  assert.strictEqual(sim.estClicks, 0);
  assert.strictEqual(sim.estConversions, 0);
  assert.strictEqual(sim.estRoas, 0);
});

test("simulateBudget - ignores unknown platform strings, falling back to the Meta default", () => {
  const bogus = simulateBudget({ objective: "OUTCOME_TRAFFIC", dailyBudgetCents: BUDGET, platforms: ["tiktok" as unknown as "meta"] });
  const meta = simulateBudget({ objective: "OUTCOME_TRAFFIC", dailyBudgetCents: BUDGET, platforms: ["meta"] });
  assert.deepStrictEqual(bogus, meta);
});
