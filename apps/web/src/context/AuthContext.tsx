import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, User, Workspace } from "../api/client.js";

// There is no login flow — every session is the single seeded demo identity
// (apps/api/prisma/seed.ts). The gateway/auth-service dev-mode bypass resolves any
// request with no Authorization header to that demo user outside production, so the
// frontend never needs to obtain or send a token. DEMO_BUSINESS_ID means a fresh browser
// session lands straight on the dashboard instead of the "set up your business" wizard —
// onboarding still runs for anyone who explicitly creates a different business.
const DEMO_WORKSPACE_ID = "demo-workspace";
const DEMO_BUSINESS_ID = "demo-business";

interface AuthState {
  user: User | null;
  workspace: Workspace | null;
  workspaceId: string | null;
  businessId: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  setBusinessId: (id: string) => void;
  setWorkspace: (ws: Workspace) => void;
  refreshWorkspace: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspaceState] = useState<Workspace | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(localStorage.getItem("adgo_workspace_id") ?? DEMO_WORKSPACE_ID);
  const [businessId, setBusinessIdState] = useState<string | null>(localStorage.getItem("businessId") ?? DEMO_BUSINESS_ID);
  const [isLoading, setIsLoading] = useState(true);

  function setBusinessId(id: string) {
    setBusinessIdState(id);
    localStorage.setItem("businessId", id);
  }

  function setWorkspace(ws: Workspace) {
    setWorkspaceState(ws);
    setWorkspaceId(ws.id);
    localStorage.setItem("adgo_workspace_id", ws.id);
  }

  async function refreshWorkspace() {
    if (!workspaceId) return;
    try {
      const ws = await api.getWorkspace(workspaceId);
      setWorkspaceState(ws);
    } catch { /* non-fatal */ }
  }

  // Resolve the demo identity on mount instead of restoring a session from a token.
  useEffect(() => {
    if (!localStorage.getItem("adgo_workspace_id")) {
      localStorage.setItem("adgo_workspace_id", DEMO_WORKSPACE_ID);
    }
    if (!localStorage.getItem("businessId")) {
      localStorage.setItem("businessId", DEMO_BUSINESS_ID);
    }
    api.me()
      .then((u) => {
        setUser(u);
        return api.getWorkspace(workspaceId ?? DEMO_WORKSPACE_ID).then(setWorkspaceState).catch(() => {});
      })
      .catch(() => { /* backend unreachable — app still renders, just without user/workspace display data */ })
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      workspace,
      workspaceId,
      businessId,
      isLoading,
      setBusinessId,
      setWorkspace,
      refreshWorkspace,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
