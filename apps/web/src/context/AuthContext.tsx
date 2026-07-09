import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, User, Workspace, AuthResult, setToken, getToken } from "../api/client.js";

interface AuthState {
  user: User | null;
  workspace: Workspace | null;
  workspaceId: string | null;
  businessId: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  setBusinessId: (id: string) => void;
  setWorkspace: (ws: Workspace) => void;
  refreshWorkspace: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspaceState] = useState<Workspace | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(localStorage.getItem("adgo_workspace_id"));
  const [businessId, setBusinessIdState] = useState<string | null>(localStorage.getItem("businessId"));
  const [isLoading, setIsLoading] = useState(Boolean(getToken()));

  async function applyAuthResult(result: AuthResult) {
    setToken(result.token);
    setUser(result.user);
    if (result.workspaceId) {
      setWorkspaceId(result.workspaceId);
      localStorage.setItem("adgo_workspace_id", result.workspaceId);
      try {
        const ws = await api.getWorkspace(result.workspaceId);
        setWorkspaceState(ws);
      } catch { /* non-fatal */ }
    }
  }

  async function login(email: string, password: string) {
    setIsLoading(true);
    try {
      const result = await api.login(email, password);
      await applyAuthResult(result);
    } finally {
      setIsLoading(false);
    }
  }

  async function signup(name: string, email: string, password: string) {
    setIsLoading(true);
    try {
      const result = await api.register({ name, email, password });
      await applyAuthResult(result);
    } finally {
      setIsLoading(false);
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    setWorkspaceState(null);
    setWorkspaceId(null);
    setBusinessIdState(null);
    localStorage.removeItem("adgo_workspace_id");
    localStorage.removeItem("businessId");
    localStorage.removeItem("adgo_token");
  }

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

  // Restore session from token on mount
  useEffect(() => {
    const token = getToken();
    if (!token) { setIsLoading(false); return; }
    api.me()
      .then((u) => {
        setUser(u);
        if (workspaceId) return api.getWorkspace(workspaceId).then(setWorkspaceState).catch(() => {});
      })
      .catch(() => logout())
      .finally(() => setIsLoading(false));
  }, []);

  const isAuthenticated = Boolean(user);

  return (
    <AuthContext.Provider value={{
      user,
      workspace,
      workspaceId,
      businessId,
      isLoading,
      isAuthenticated,
      login,
      signup,
      logout,
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
