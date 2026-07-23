import { createContext, useContext, type ReactNode } from "react";
import { useRealtime } from "../hooks/useRealtime.js";
import { useAuth } from "../context/AuthContext.js";

type SubscribeFn = (channel: string, handler: (channel: string, payload: unknown) => void) => () => void;
type RealtimeStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

interface RealtimeContextValue {
  subscribe: SubscribeFn;
  status: RealtimeStatus;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  subscribe: () => () => {},
  status: "disconnected",
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { workspaceId, businessId } = useAuth();
  const { subscribe, status } = useRealtime(workspaceId ?? undefined, businessId ?? undefined);

  return (
    <RealtimeContext.Provider value={{ subscribe, status }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeContext() {
  return useContext(RealtimeContext);
}
