import { prisma } from "../db/prisma.js";
import type { PerformanceMetric } from "../types/index.js";

/**
 * Provider-agnostic time-series metric storage. `performancePipeline.ts` talks
 * only to this interface, not to Prisma directly, so swapping Postgres for
 * ClickHouse/TimescaleDB (roadmap Phase 4, once metric volume justifies it) is
 * a new implementation of this interface — the campaign-service call sites
 * that read/write metrics don't change.
 */
export interface AnalyticsStore {
  recordMetric(metric: PerformanceMetric): Promise<void>;
  queryMetrics(campaignId: string): Promise<PerformanceMetric[]>;
}

/** Today's default: metrics live in the same Postgres database as everything else. */
export class PrismaAnalyticsStore implements AnalyticsStore {
  async recordMetric(metric: PerformanceMetric): Promise<void> {
    await prisma.metric.create({
      data: { id: metric.id, campaignId: metric.campaignId, data: metric as any, date: metric.date },
    });
  }

  async queryMetrics(campaignId: string): Promise<PerformanceMetric[]> {
    const rows = await prisma.metric.findMany({ where: { campaignId }, orderBy: { date: "desc" } });
    return rows.map((r) => r.data as unknown as PerformanceMetric);
  }
}

export const analyticsStore: AnalyticsStore = new PrismaAnalyticsStore();
