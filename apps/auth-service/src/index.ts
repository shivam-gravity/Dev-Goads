import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { asyncHandler } from "./asyncHandler.js";
import { register, login, googleAuth, getUserById, verifyToken } from "../../api/src/modules/auth/authService.js";
import {
  getWorkspace,
  listWorkspacesForUser,
  updateWorkspace,
  listMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
} from "../../api/src/modules/workspace/workspaceService.js";

const app = express();
const PORT = Number(process.env.AUTH_SERVICE_PORT ?? 4001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "auth-service" }));

/* ═══════════════════════════════════════════════
   AUTH — extracted from the gateway per roadmap Phase 2.
   The gateway proxies /auth/register, /auth/login, /auth/google, /auth/me here;
   /auth/demo-token stays gateway-side since it's about the gateway's own
   stateless JWT verification, not user account data.
   ═══════════════════════════════════════════════ */

app.post("/auth/register", asyncHandler(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await register(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Registration failed" });
  }
}));

app.post("/auth/login", asyncHandler(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await login(parsed.data.email, parsed.data.password));
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Login failed" });
  }
}));

app.post("/auth/google", asyncHandler(async (req, res) => {
  const parsed = z.object({ name: z.string(), email: z.string().email(), googleId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await googleAuth(parsed.data.name, parsed.data.email, parsed.data.googleId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Google auth failed" });
  }
}));

app.get("/auth/me", asyncHandler(async (req, res) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing auth" });
  try {
    const { userId } = verifyToken(header.replace(/^Bearer\s+/i, ""));
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}));

/* ═══════════════════════════════════════════════
   WORKSPACES
   ═══════════════════════════════════════════════ */

app.get("/workspaces/for-user/:userId", asyncHandler(async (req, res) => res.json(await listWorkspacesForUser(req.params.userId))));

app.get("/workspaces/:id", asyncHandler(async (req, res) => {
  const ws = await getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "Workspace not found" });
  res.json(ws);
}));

app.patch("/workspaces/:id", asyncHandler(async (req, res) => {
  const parsed = z.object({ name: z.string().optional(), logoUrl: z.string().optional(), timezone: z.string().optional(), plan: z.enum(["starter", "pro", "agency"]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await updateWorkspace(req.params.id, parsed.data)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" }); }
}));

app.get("/workspaces/:id/members", asyncHandler(async (req, res) => res.json(await listMembers(req.params.id))));

app.post("/workspaces/:id/members/invite", asyncHandler(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), role: z.enum(["admin", "member", "viewer"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.status(201).json(await inviteMember(req.params.id, parsed.data.email, parsed.data.role)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Invite failed" }); }
}));

app.patch("/workspaces/members/:memberId/role", asyncHandler(async (req, res) => {
  const parsed = z.object({ role: z.enum(["admin", "member", "viewer"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try { res.json(await updateMemberRole(req.params.memberId, parsed.data.role)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" }); }
}));

app.delete("/workspaces/members/:memberId", asyncHandler(async (req, res) => {
  await removeMember(req.params.memberId);
  res.status(204).send();
}));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`AdGo Auth Service listening on http://localhost:${PORT}`);
});
