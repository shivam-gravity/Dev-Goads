import { listAutomationRules, createAutomationRule, type AutomationRule } from "./automationRuleService.js";
import { logger } from "../logger/logger.js";

/**
 * The "fuse" — a set of always-on safety guardrails so a campaign can't quietly bleed money
 * while nobody's watching. This is the piece AdsGo markets as its auto-shutdown circuit breaker.
 *
 * Before this, the only automatic kill was the optimizer's RELATIVE pause (a variant whose CPA is
 * >2.5x the cohort's best) — which never fires if every variant is losing money equally, and the
 * absolute-threshold rule engine only acted on rules a user hand-created. The fuse closes that gap
 * by seeding sensible ABSOLUTE guardrails for every workspace, evaluated by the same 15-minute
 * automationRuleWorker that already runs. Users can edit or disable them like any other rule.
 *
 * Guardrails are conservative defaults meant to prevent catastrophic loss, not to micro-optimize:
 *   - max CPA:    pause if cost-per-acquisition blows past a hard ceiling
 *   - min ROAS:   pause if return on ad spend falls below break-even-ish
 *   - spend cap:  pause if daily spend runs away (a runaway-delivery backstop)
 * All three PAUSE (never silently adjust budget) — a tripped fuse should stop spend and surface,
 * not keep running at a lower burn. Each carries a long cooldown so a flapping metric near the
 * threshold can't thrash the campaign on/off every tick.
 */

/** Marks a rule as fuse-seeded so we can detect (and not duplicate) the defaults. Stored in the rule blob. */
export const FUSE_RULE_SOURCE = "fuse-default";

/** Default cooldown (minutes) — once a guardrail trips, don't re-evaluate it for a while. */
const FUSE_COOLDOWN_MINUTES = 6 * 60;

export interface FuseGuardrailSpec {
  key: string;
  name: string;
  metric: "cpa" | "roas" | "spend";
  operator: "gt" | "lt";
  thresholdValue: number;
  reason: string;
}

/**
 * The default guardrail set. Thresholds are intentionally loose (catastrophe-prevention, not
 * fine-tuning) and expressed in the same units the rule engine's computeMetricValue produces:
 * cpa/spend in whole currency units, roas as a raw ratio.
 */
export const DEFAULT_FUSE_GUARDRAILS: FuseGuardrailSpec[] = [
  {
    key: "max-cpa",
    name: "Fuse: pause on runaway CPA",
    metric: "cpa",
    operator: "gt",
    thresholdValue: 100, // pause if CPA exceeds 100 / acquisition
    reason: "Cost per acquisition exceeded the safety ceiling",
  },
  {
    key: "min-roas",
    name: "Fuse: pause on unprofitable ROAS",
    metric: "roas",
    operator: "lt",
    thresholdValue: 0.75, // pause if return on ad spend drops below 0.75x (losing money)
    reason: "Return on ad spend fell below the break-even floor",
  },
  {
    key: "spend-cap",
    name: "Fuse: pause on daily spend runaway",
    metric: "spend",
    operator: "gt",
    thresholdValue: 500, // pause if a single day's spend blows past this backstop
    reason: "Daily spend ran past the safety cap",
  },
];

/** A fuse rule is an ordinary AutomationRule plus a source marker and a guardrail key, kept in the blob. */
interface FuseRuleExtra {
  source?: string;
  fuseKey?: string;
}

function isFuseRule(rule: AutomationRule): boolean {
  return (rule as AutomationRule & FuseRuleExtra).source === FUSE_RULE_SOURCE;
}

/**
 * Ensure a workspace has the default fuse guardrails. Idempotent: only creates guardrails whose
 * `fuseKey` isn't already present, so calling it repeatedly (e.g. on every launch) is safe and
 * won't clobber a user's edits to an existing guardrail. Returns the guardrails created this call.
 */
export async function ensureFuseGuardrails(workspaceId: string): Promise<AutomationRule[]> {
  const existing = await listAutomationRules(workspaceId);
  const existingFuseKeys = new Set(
    existing
      .filter(isFuseRule)
      .map((r) => (r as AutomationRule & FuseRuleExtra).fuseKey)
      .filter((k): k is string => Boolean(k)),
  );

  const created: AutomationRule[] = [];
  for (const spec of DEFAULT_FUSE_GUARDRAILS) {
    if (existingFuseKeys.has(spec.key)) continue;
    // createAutomationRule spreads `input` into the stored blob, so the extra source/fuseKey/reason
    // fields ride along on the rule and survive round-trips through listAutomationRules.
    const rule = await createAutomationRule(workspaceId, {
      name: spec.name,
      metric: spec.metric,
      operator: spec.operator,
      thresholdValue: spec.thresholdValue,
      action: "pause_campaign",
      cooldownMinutes: FUSE_COOLDOWN_MINUTES,
      priority: "high",
      ...( { source: FUSE_RULE_SOURCE, fuseKey: spec.key, fuseReason: spec.reason } as object ),
    } as Omit<AutomationRule, "id" | "workspaceId" | "createdAt" | "updatedAt" | "enabled">);
    created.push(rule);
  }

  if (created.length > 0) {
    logger.info(`campaignFuse: seeded ${created.length} default guardrail(s) for workspace ${workspaceId}`);
  }
  return created;
}
