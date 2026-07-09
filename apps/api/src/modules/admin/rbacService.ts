import { prisma } from "../../db/prisma.js";

export type RbacMatrix = Record<string, Record<string, boolean>>;

const DEFAULT_MATRIX: RbacMatrix = {
  owner: { billing: true, campaigns: true, creatives: true, members: true, settings: true },
  admin: { billing: false, campaigns: true, creatives: true, members: true, settings: true },
  member: { billing: false, campaigns: true, creatives: true, members: false, settings: false },
  viewer: { billing: false, campaigns: false, creatives: false, members: false, settings: false },
};

export async function getRbacMatrix(workspaceId: string): Promise<RbacMatrix> {
  const row = await prisma.rbacRoleMatrix.findUnique({ where: { id: workspaceId } });
  return row ? (row.data as unknown as RbacMatrix) : DEFAULT_MATRIX;
}

export async function setRbacMatrix(workspaceId: string, matrix: RbacMatrix): Promise<RbacMatrix> {
  await prisma.rbacRoleMatrix.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, data: matrix as any },
    update: { data: matrix as any },
  });
  return matrix;
}
