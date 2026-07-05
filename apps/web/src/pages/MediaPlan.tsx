import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import AdsGoHeader from "../components/AdsGoHeader.js";
import { api } from "../api/client.js";
import type { StrategistChatMessage } from "../api/client.js";

const TABS = ["Performance", "Agent activity", "Capabilities", "Decision support"] as const;
type Tab = (typeof TABS)[number];

const SUGGESTIONS: Record<Tab, string[]> = {
  Performance: [
    "How much did I spend on ads today, and how did they perform?",
    "Am I hitting my target ROAS this week?",
    "Which campaign is underperforming right now?"
  ],
  "Agent activity": [
    "What changes did the AI make in the last 24 hours?",
    "Show me every budget shift this week.",
    "Which campaigns were paused automatically?"
  ],
  Capabilities: [
    "What can you help me do with my media plan?",
    "Can you generate a new campaign plan for me?",
    "How do you decide when to scale a winner?"
  ],
  "Decision support": [
    "Should I increase budget on my top campaign?",
    "Is now a good time to launch a new creative test?",
    "Help me decide between Meta and Google for this budget."
  ]
};

interface ChatMessage {
  id: string;
  sender: "user" | "strategist";
  text: string;
}

export default function MediaPlan({ businessId }: { businessId: string }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("Performance");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    const history: StrategistChatMessage[] = [
      ...messages.map((m) => ({ role: m.sender === "user" ? ("user" as const) : ("assistant" as const), content: m.text })),
      { role: "user", content: trimmed }
    ];

    setMessages((prev) => [...prev, { id: `msg-${prev.length}-u`, sender: "user", text: trimmed }]);
    setInputValue("");
    setError(null);
    setIsSending(true);
    requestAnimationFrame(resizeTextarea);

    try {
      const { reply } = await api.chatWithStrategist(businessId, history);
      setMessages((prev) => [...prev, { id: `msg-${prev.length}-s`, sender: "strategist", text: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong reaching the strategist.");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputValue);
    }
  }

  return (
    <div className="page-media-plan">
      <AdsGoHeader breadcrumb={["Media Plan"]} />

      <div className="media-plan-layout">
        <section className="media-plan-hero-card">
          <div className="media-plan-hero-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7033f5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
              <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
            </svg>
          </div>

          <h2 className="media-plan-hero-title">Launch your first campaign</h2>
          <p className="media-plan-hero-desc">
            Your Media Plan will come to life once your ads are running. Create and publish a campaign — AdsGo will
            take it from there.
          </p>

          <button className="media-plan-cta" onClick={() => navigate("/campaigns/new")}>
            Create Your First Campaign
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>

          <div className="media-plan-divider" />

          <span className="media-plan-section-label">WHAT HAPPENS AFTER YOU PUBLISH</span>

          <div className="media-plan-steps">
            <div className="media-plan-step">
              <span className="media-plan-step-icon blue">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 8.82a15 15 0 0 1 20 0" />
                  <path d="M5 12.859a10 10 0 0 1 14 0" />
                  <path d="M8.5 16.429a5 5 0 0 1 7 0" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </svg>
              </span>
              <span>Ads go live on Meta within hours</span>
            </div>

            <div className="media-plan-step">
              <span className="media-plan-step-icon orange">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.9 4.6L18 9l-4.1 1.4L12 15l-1.9-4.6L6 9l4.1-1.4L12 3z" />
                  <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
                </svg>
              </span>
              <span>AdsGo starts syncing performance data every hour</span>
            </div>

            <div className="media-plan-step">
              <span className="media-plan-step-icon green">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              </span>
              <span>AI optimizes budgets, pauses losers, scales winners</span>
            </div>

            <div className="media-plan-step">
              <span className="media-plan-step-icon purple">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              <span>Your ad insights populates with real-time</span>
            </div>
          </div>
        </section>

        <aside className="media-plan-chat-panel">
          <div className="media-plan-chat-header">
            <span className="media-plan-chat-title">Chat with Strategist</span>
            <div className="media-plan-chat-header-actions">
              <button
                className="media-plan-icon-btn"
                aria-label="New chat"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button className="media-plan-icon-btn" aria-label="Chat history">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15.5 14" />
                </svg>
              </button>
              <button className="media-plan-icon-btn" aria-label="Chat settings">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="media-plan-chat-body">
            {messages.length === 0 ? (
              <div className="media-plan-chat-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4c4d1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                  <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                </svg>
                <p>
                  Ask the strategist to generate, revise or evaluate a Media Plan, or set long-term brand
                  preferences.
                </p>
              </div>
            ) : (
              <div className="media-plan-chat-messages">
                {messages.map((m) => (
                  <div key={m.id} className={`media-plan-chat-bubble ${m.sender}`}>
                    {m.text}
                  </div>
                ))}
                {isSending && (
                  <div className="media-plan-chat-bubble strategist typing">
                    <span className="media-plan-typing-dot" />
                    <span className="media-plan-typing-dot" />
                    <span className="media-plan-typing-dot" />
                  </div>
                )}
                {error && <div className="media-plan-chat-error">{error}</div>}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div className="media-plan-chat-tabs">
            {TABS.map((tab) => (
              <button
                key={tab}
                className={`media-plan-chat-tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="media-plan-chat-suggestions">
            {SUGGESTIONS[activeTab].map((s) => (
              <button key={s} className="media-plan-suggestion-chip" onClick={() => handleSend(s)} disabled={isSending}>
                {s}
              </button>
            ))}
          </div>

          <div className="media-plan-chat-input-row">
            <textarea
              ref={textareaRef}
              className="media-plan-chat-input"
              placeholder="Type a message. Enter to send · Shift+Enter for a new line"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                resizeTextarea();
              }}
              onKeyDown={handleKeyDown}
              disabled={isSending}
              rows={1}
            />
            <button
              className="media-plan-send-btn"
              onClick={() => handleSend(inputValue)}
              disabled={isSending || !inputValue.trim()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
              </svg>
              Send
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
