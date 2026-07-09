import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

export interface AutomationRule {
  id: string;
  workspaceId: string;
  name: string;
  metric: string;
  operator: "gt" | "lt" | "eq";
  thresholdValue: number;
  action: string;
  actionParam?: string;
  cooldownMinutes: number;
  priority: "low" | "medium" | "high";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

async function save(r: AutomationRule): Promise<void> {
  await prisma.automationRule.upsert({
    where: { id: r.id },
    create: { id: r.id, workspaceId: r.workspaceId, data: r as any, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) },
    update: { data: r as any, updatedAt: new Date(r.updatedAt) },
  });
}

export async function listAutomationRules(workspaceId: string): Promise<AutomationRule[]> {
  const rows = await prisma.automationRule.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as AutomationRule);
}

export async function createAutomationRule(
  workspaceId: string,
  input: Omit<AutomationRule, "id" | "workspaceId" | "createdAt" | "updatedAt" | "enabled">,
): Promise<AutomationRule> {
  const now = new Date().toISOString();
  const r: AutomationRule = { id: randomUUID(), workspaceId, enabled: true, createdAt: now, updatedAt: now, ...input };
  await save(r);
  return r;
}

export async function deleteAutomationRule(id: string): Promise<boolean> {
  const r = await prisma.automationRule.deleteMany({ where: { id } });
  return r.count > 0;
}
