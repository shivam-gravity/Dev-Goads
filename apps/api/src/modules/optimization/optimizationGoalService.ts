import { prisma } from "../../db/prisma.js";

export interface OptimizationGoal {
  dailyBudgetCents: number;
  primaryKpi: string;
  locations: string[];
}

const DEFAULTS: OptimizationGoal = { dailyBudgetCents: 0, primaryKpi: "conversions", locations: [] };

export async function getOptimizationGoal(workspaceId: string): Promise<OptimizationGoal> {
  const row = await prisma.optimizationGoal.findUnique({ where: { id: workspaceId } });
  return row ? { ...DEFAULTS, ...(row.data as unknown as OptimizationGoal) } : DEFAULTS;
}

export async function setOptimizationGoal(workspaceId: string, goal: OptimizationGoal): Promise<OptimizationGoal> {
  await prisma.optimizationGoal.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, data: goal as any },
    update: { data: goal as any },
  });
  return goal;
}
