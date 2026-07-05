import { createContext, useContext, useState, ReactNode } from "react";

export type CopilotStatus =
  | "Closed"
  | "Opening"
  | "Idle"
  | "Thinking"
  | "Streaming"
  | "ToolExecution"
  | "Completed"
  | "Error";

export interface ChatMessage {
  id: string;
  sender: "user" | "copilot";
  text: string;
  timestamp: string;
}

interface CopilotContextValue {
  isOpen: boolean;
  status: CopilotStatus;
  messages: ChatMessage[];
  openCopilot: () => void;
  closeCopilot: () => void;
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<CopilotStatus>("Closed");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "init-1",
      sender: "copilot",
      text: "Hi ssrivastava! I'm your AdsGo Copilot. How can I help optimize your campaigns or branding today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  function openCopilot() {
    setIsOpen(true);
    setStatus("Idle");
  }

  function closeCopilot() {
    setIsOpen(false);
    setStatus("Closed");
  }

  function clearChat() {
    setMessages([
      {
        id: `init-${Date.now()}`,
        sender: "copilot",
        text: "Hi ssrivastava! I'm your AdsGo Copilot. How can I help optimize your campaigns or branding today?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
    setStatus("Idle");
  }

  async function sendMessage(text: string) {
    if (!text.trim()) return;

    // 1. Add User Message
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: "user",
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    setMessages(prev => [...prev, userMsg]);
    setStatus("Thinking");

    // Simulate thinking delay
    await new Promise(r => setTimeout(r, 800));
    setStatus("ToolExecution");

    // Simulate backend API tools delay
    await new Promise(r => setTimeout(r, 600));
    setStatus("Streaming");

    // Determine simulated response based on queries
    let reply = "";
    const cleanText = text.toLowerCase();

    if (cleanText.includes("budget")) {
      reply = "I've analyzed your campaigns. I recommend increasing the budget for **Acme Lead Gen** (performing at 4.2x ROAS) by 20% (+$50/day). Shall I prepare a draft modification request for approval?";
    } else if (cleanText.includes("poor performers") || cleanText.includes("poor")) {
      reply = "Here are your low-performing assets based on last 7 days metrics:\n\n* **Summer Retargeting** (Meta): 1.1x ROAS (Target: 2.5x)\n* **Ad variant Headline 3** (Google): 0.5% CTR (Target: 1.5%)\n\nI recommend redistributing $25/day from these assets to your high-performing Search campaign.";
    } else if (cleanText.includes("headlines") || cleanText.includes("headline")) {
      reply = "Here are 5 high-converting headlines tailored to your Brand Kit specifications:\n\n1. *'Scale Your Lead Gen in 15 Mins'* (Direct)\n2. *'The Smarter Way to Automate Ads'* (Benefit)\n3. *'Double Your ROAS with AdsGo.ai'* (Proof)\n4. *'Stop Wasting 6 Hours a Week'* (Pain-point)\n5. *'Try AdsGo Free — Launch Today'* (CTA)";
    } else if (cleanText.includes("meta") || cleanText.includes("pause")) {
      reply = "I've prepared a draft action to pause all active Meta campaigns (3 running). Should I submit this to the approval workflow?";
    } else if (cleanText.includes("compare")) {
      reply = "Comparing July 2026 to June 2026 performance:\n\n* **Spend**: $14,200 vs $12,800 (+11%)\n* **Conversions**: 1,840 vs 1,420 (+29.5%)\n* **Avg ROAS**: 3.82x vs 3.20x (+19.4%)\n\nOverall campaign efficiency increased due to epsilon-greedy budget shifts to winning Google Ad variants.";
    } else if (cleanText.includes("ctr") || cleanText.includes("drop")) {
      reply = "CTR dropped from 2.8% to 1.9% on June 30 due to Meta ad fatigue on creative variant 'Save 15% Today'. I recommend swapping in a fresh design asset or generating new copy variations.";
    } else {
      reply = "I've analyzed your question. I can help you budget scale, find poor performers, draft copy variations, or sync analytics logs. Try using one of the quick action suggestions!";
    }

    // Stream character-by-character for a premium feel
    const copilotMsgId = `cop-${Date.now()}`;
    const copilotMsg: ChatMessage = {
      id: copilotMsgId,
      sender: "copilot",
      text: "",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, copilotMsg]);

    let currentText = "";
    const chars = Array.from(reply);
    
    for (let i = 0; i < chars.length; i++) {
      currentText += chars[i];
      // Batch state updates to avoid excessive re-renders but keep smooth streaming
      if (i % 2 === 0 || i === chars.length - 1) {
        setMessages(prev =>
          prev.map(m => (m.id === copilotMsgId ? { ...m, text: currentText } : m))
        );
      }
      // Speed up streaming for longer messages
      const delay = chars.length > 200 ? 5 : 12;
      await new Promise(r => setTimeout(r, delay));
    }

    setStatus("Completed");
  }

  return (
    <CopilotContext.Provider value={{
      isOpen,
      status,
      messages,
      openCopilot,
      closeCopilot,
      sendMessage,
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
