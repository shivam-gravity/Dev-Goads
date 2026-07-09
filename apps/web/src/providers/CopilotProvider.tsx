import { createContext, useContext, useState, ReactNode } from "react";
import { api } from "../api/client.js";
import type { StrategistChatMessage } from "../api/client.js";
import { useAuth } from "../context/AuthContext.js";

export type CopilotStatus =
  | "Closed"
  | "Opening"
  | "Idle"
  | "Thinking"
  | "ToolExecution"
  | "Streaming"
  | "Completed"
  | "Error";

export interface ChatMessage {
  id: string;
  sender: "user" | "copilot";
  text: string;
  timestamp: string;
  isError?: boolean;
}

interface CopilotContextValue {
  isOpen: boolean;
  status: CopilotStatus;
  messages: ChatMessage[];
  canRetry: boolean;
  openCopilot: () => void;
  closeCopilot: () => void;
  sendMessage: (text: string) => Promise<void>;
  retryLast: () => Promise<void>;
  clearChat: () => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function greeting(name?: string): ChatMessage {
  return {
    id: `init-${Date.now()}`,
    sender: "copilot",
    text: `Hi${name ? ` ${name}` : ""}! I'm your CRM Ads Copilot. Ask me about spend, ROAS, underperforming campaigns, or headline ideas — I'll ground the answer in your real account data.`,
    timestamp: timestamp(),
  };
}

function toHistory(messages: ChatMessage[]): StrategistChatMessage[] {
  return messages.filter((m) => !m.isError).map((m) => ({ role: m.sender === "user" ? ("user" as const) : ("assistant" as const), content: m.text }));
}

async function revealCharByChar(text: string, onUpdate: (partial: string) => void) {
  let current = "";
  const chars = Array.from(text);
  const delay = chars.length > 200 ? 4 : 10;
  for (let i = 0; i < chars.length; i++) {
    current += chars[i];
    if (i % 2 === 0 || i === chars.length - 1) onUpdate(current);
    await new Promise((r) => setTimeout(r, delay));
  }
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const { user, businessId } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<CopilotStatus>("Closed");
  const [messages, setMessages] = useState<ChatMessage[]>([greeting(user?.name)]);
  const [canRetry, setCanRetry] = useState(false);

  function openCopilot() {
    setIsOpen(true);
    setStatus("Idle");
  }

  function closeCopilot() {
    setIsOpen(false);
    setStatus("Closed");
  }

  function clearChat() {
    setMessages([greeting(user?.name)]);
    setStatus("Idle");
    setCanRetry(false);
  }

  async function runTurn(history: StrategistChatMessage[]) {
    if (!businessId) {
      setStatus("Error");
      setCanRetry(false);
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, sender: "copilot", text: "I don't have a business to look at yet — finish onboarding first and I'll be able to help.", timestamp: timestamp(), isError: true }]);
      return;
    }

    try {
      setStatus("ToolExecution");
      const { reply } = await api.chatWithCopilot(businessId, history);
      setStatus("Streaming");

      const copilotMsgId = `cop-${Date.now()}`;
      setMessages((prev) => [...prev, { id: copilotMsgId, sender: "copilot", text: "", timestamp: timestamp() }]);
      await revealCharByChar(reply, (partial) => {
        setMessages((prev) => prev.map((m) => (m.id === copilotMsgId ? { ...m, text: partial } : m)));
      });
      setStatus("Completed");
      setCanRetry(false);
    } catch (err) {
      setStatus("Error");
      setCanRetry(true);
      const message = err instanceof Error ? err.message : "Something went wrong reaching the Copilot.";
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, sender: "copilot", text: message, timestamp: timestamp(), isError: true }]);
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = { id: `usr-${Date.now()}`, sender: "user", text: trimmed, timestamp: timestamp() };
    const history = [...toHistory(messages), { role: "user" as const, content: trimmed }];
    setMessages((prev) => [...prev, userMsg]);
    setStatus("Thinking");
    setCanRetry(false);
    await runTurn(history);
  }

  async function retryLast() {
    setMessages((prev) => prev.filter((m) => !m.isError));
    setStatus("Thinking");
    await runTurn(toHistory(messages));
  }

  return (
    <CopilotContext.Provider value={{
      isOpen,
      status,
      messages,
      canRetry,
      openCopilot,
      closeCopilot,
      sendMessage,
      retryLast,
      clearChat
    }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot() {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot must be used inside CopilotProvider");
  return ctx;
}
