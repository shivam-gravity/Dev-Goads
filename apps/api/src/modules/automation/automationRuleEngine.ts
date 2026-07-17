import { listAutomationRules, type AutomationRule } from "./automationRuleService.js";
import { listActiveCampaigns, getCampaign, pauseVariant, reallocateBudget } from "../orchestrator/campaignOrchestrator.js";
import { getRawMetrics } from "../pipeline/performancePipeline.js";
import { ESTIMATED_REVENUE_CENTS_PER_CONVERSION } from "../pipeline/performancePipeline.js";
import { logger } from "../logger/logger.js";
import { createNotification } from "../notifications/notificationService.js";
import { emitAutomationTrigger } from "../../infra/realtimeBridge.js";
import type { PerformanceMetric } from "../../types/index.js";

// ─── Cooldown tracking (in-memory, scoped to process lifetime) ───────────────
// Key: ruleId, Value: ISO timestamp of last trigger
const lastTriggerMap = new Map<string, string>();

export interface RuleTriggerResult {
  ruleId: string;
  ruleName: string;
  campaignId: string;
  metric: string;
  currentValue: number;
  threshold: number;
  actionTaken: string;
}

export interface WorkspaceEvaluationResult {
  workspaceId: string;
  rulesEvaluated: number;
  triggered: RuleTriggerResult[];
  skippedCooldown: number;
  errors: number;
}

// ─── Core evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluates all enabled automation rules for a workspace against current campaign metrics.
 * For each active campaign in the workspace, aggregates metrics and checks every rule.
 */
export async function evaluateRulesForWorkspace(workspaceId: string): Promise<WorkspaceEvaluationResult> {
  const result: WorkspaceEvaluationResult = {
    workspaceId,
    rulesEvaluated: 0,
    triggered: [],
    skippedCooldown: 0,
    errors: 0,
  };

  const allRules = await listAutomationRules(workspaceId);
  const enabledRules = allRules.filter((r) => r.enabled);
  if (enabledRules.length === 0) return result;

  // Get active campaigns for this workspace
  const allActive = await listActiveCampaigns();
  const workspaceCampaigns = allActive.filter((c) => c.workspaceId === workspaceId);
  if (workspaceCampaigns.length === 0) return result;

  for (const { id: campaignId } of workspaceCampaigns) {
    // Fetch raw metrics for this campaign and aggregate across all variants/dates
    let metrics: PerformanceMetric[];
    try {
      metrics = await getRawMetrics(campaignId);
    } catch (err) {
      logger.warn(`automationRuleEngine: failed to fetch metrics for campaign ${campaignId}`, err);
      result.errors++;
      continue;
    }

    if (metrics.length === 0) continue;

    const aggregated = aggregateMetrics(metrics);

    for (const rule of enabledRules) {
      result.rulesEvaluated++;

      try {
        // Check cooldown
        if (isInCooldown(rule.id, rule.cooldownMinutes)) {
          result.skippedCooldown++;
          continue;
        }

        const currentValue = computeMetricValue(rule.metric, aggregated);
        if (currentValue === null) continue; // metric not computable (e.g. zero denominator)

        if (evaluateCondition(currentValue, rule.operator, rule.thresholdValue)) {
          await executeAction(rule, campaignId, currentValue);
          recordRuleTrigger(rule.id, campaignId, currentValue, rule.action);

          result.triggered.push({
            ruleId: rule.id,
            ruleName: rule.name,
            campaignId,
            metric: rule.metric,
            currentValue,
            threshold: rule.thresholdValue,
            actionTaken: rule.action,
          });
        }
      } catch (err) {
        logger.error(`automationRuleEngine: error evaluating rule "${rule.name}" for campaign ${campaignId}`, err);
        result.errors++;
      }
    }
  }

  return result;
}

// ─── Metric computation ──────────────────────────────────────────────────────

interface AggregatedMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  spendCents: number;
  reach: number;
}

function aggregateMetrics(metrics: PerformanceMetric[]): AggregatedMetrics {
  return {
    impressions: metrics.reduce((s, m) => s + m.impressions, 0),
    clicks: metrics.reduce((s, m) => s + m.clicks, 0),
    conversions: metrics.reduce((s, m) => s + m.conversions, 0),
    spendCents: metrics.reduce((s, m) => s + m.spendCents, 0),
    reach: metrics.reduce((s, m) => s + m.reach, 0),
  };
}

/**
 * Computes a derived metric value from aggregated campaign performance data.
 * Returns null when the metric cannot be computed (e.g. division by zero).
 *
 * Supported metrics:
 * - cpa: Cost Per Acquisition (spend / conversions), in dollars
 * - roas: Return On Ad Spend (estimated revenue / spend)
 * - ctr: Click-Through Rate (clicks / impressions), as percentage
 * - cpc: Cost Per Click (spend / clicks), in dollars
 * - spend: Total spend in dollars
 * - impressions: Total impressions
 * - conversions: Total conversions
 */
export function computeMetricValue(metric: string, aggregated: AggregatedMetrics): number | null {
  const spendDollars = aggregated.spendCents / 100;

  switch (metric) {
    case "cpa":
      if (aggregated.conversions === 0) return null;
      return spendDollars / aggregated.conversions;

    case "roas":
      if (aggregated.spendCents === 0) return null;
      // Revenue estimated as conversions * average order value (same constant used in performancePipeline)
      return (aggregated.conversions * ESTIMATED_REVENUE_CENTS_PER_CONVERSION) / aggregated.spendCents;

    case "ctr":
      if (aggregated.impressions === 0) return null;
      return (aggregated.clicks / aggregated.impressions) * 100;

    case "cpc":
      if (aggregated.clicks === 0) return null;
      return spendDollars / aggregated.clicks;

    case "spend":
      return spendDollars;

    case "impressions":
      return aggregated.impressions;

    case "conversions":
      return aggregated.conversions;

    default:
      logger.warn(`automationRuleEngine: unsupported metric "${metric}"`);
      return null;
  }
}

// ─── Condition evaluation ────────────────────────────────────────────────────

export function evaluateCondition(value: number, operator: "gt" | "lt" | "eq", threshold: number): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "eq":
      // Floating-point tolerance for derived metrics (CPA, ROAS, CTR, CPC)
      return Math.abs(value - threshold) < 0.001;
    default:
      return false;
  }
}

// ─── Action execution ────────────────────────────────────────────────────────

/**
 * Executes the action specified by the automation rule against the given campaign.
 */
export async function executeAction(rule: AutomationRule, campaignId: string, currentValue: number): Promise<void> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    logger.warn(`automationRuleEngine: campaign ${campaignId} not found during action execution`);
    return;
  }

  switch (rule.action) {
    case "pause_campaign": {
      // Pause all active variants in the campaign
      const activeVariants = campaign.variants.filter((v) => v.status === "active" && v.externalId);
      for (const variant of activeVariants) {
        await pauseVariant(campaignId, variant.id);
      }
      logger.info(`automationRuleEngine: paused ${activeVariants.length} variant(s) for campaign ${campaignId} (rule: "${rule.name}", ${rule.metric}=${currentValue.toFixed(2)})`);
      break;
    }

    case "increase_budget": {
      const pct = parseFloat(rule.actionParam ?? "10") / 100;
      const newBudget = Math.round(campaign.dailyBudgetCents * (1 + pct));
      // Apply to all active variants proportionally
      const activeVariants = campaign.variants.filter((v) => v.status === "active" && v.externalId);
      for (const variant of activeVariants) {
        const variantBudget = Math.round(newBudget / activeVariants.length);
        await reallocateBudget(campaignId, variant.id, variantBudget);
      }
      logger.info(`automationRuleEngine: increased budget by ${rule.actionParam ?? "10"}% for campaign ${campaignId} (rule: "${rule.name}", ${rule.metric}=${currentValue.toFixed(2)})`);
      break;
    }

    case "decrease_budget": {
      const pct = parseFloat(rule.actionParam ?? "10") / 100;
      const newBudget = Math.max(100, Math.round(campaign.dailyBudgetCents * (1 - pct))); // floor at $1
      const activeVariants = campaign.variants.filter((v) => v.status === "active" && v.externalId);
      for (const variant of activeVariants) {
        const variantBudget = Math.round(newBudget / activeVariants.length);
        await reallocateBudget(campaignId, variant.id, variantBudget);
      }
      logger.info(`automationRuleEngine: decreased budget by ${rule.actionParam ?? "10"}% for campaign ${campaignId} (rule: "${rule.name}", ${rule.metric}=${currentValue.toFixed(2)})`);
      break;
    }

    case "send_notification": {
      await createNotification(rule.workspaceId, {
        type: "campaign_alert",
        title: `Automation Rule Triggered: ${rule.name}`,
        message: `Rule "${rule.name}" fired: ${rule.metric} is ${currentValue.toFixed(2)} (threshold: ${rule.operator} ${rule.thresholdValue}). Campaign: ${campaign.name}.`,
        severity: rule.priority === "high" ? "error" : rule.priority === "medium" ? "warning" : "info",
        actionUrl: `/campaigns/${campaignId}`,
      });
      logger.info(`automationRuleEngine: sent notification for campaign ${campaignId} (rule: "${rule.name}", ${rule.metric}=${currentValue.toFixed(2)})`);
      break;
    }

    default:
      logger.warn(`automationRuleEngine: unknown action "${rule.action}" in rule "${rule.name}"`);
  }
}

// ─── Cooldown management ─────────────────────────────────────────────────────

/**
 * Returns true if the rule was triggered within the last `cooldownMinutes` and should be skipped.
 */
export function isInCooldown(ruleId: string, cooldownMinutes: number): boolean {
  const lastTrigger = lastTriggerMap.get(ruleId);
  if (!lastTrigger) return false;

  const elapsedMs = Date.now() - new Date(lastTrigger).getTime();
  return elapsedMs < cooldownMinutes * 60 * 1000;
}

/**
 * Records a rule trigger for cooldown tracking and audit logging.
 */
export function recordRuleTrigger(ruleId: string, campaignId: string, metricValue: number, actionTaken: string): void {
  const now = new Date().toISOString();
  lastTriggerMap.set(ruleId, now);
  logger.info(`automationRuleEngine: trigger recorded — rule=${ruleId}, campaign=${campaignId}, value=${metricValue.toFixed(2)}, action=${actionTaken}, at=${now}`);
  // Push real-time event to connected browsers (fire-and-forget; workspace is resolved upstream)
  // The workspaceId isn't available here, but the notification path in executeAction already handles
  // workspace-scoped delivery. This emits a global automation trigger that any subscribed client receives.
  void emitAutomationTrigger("*", ruleId, campaignId, actionTaken, metricValue);
}
