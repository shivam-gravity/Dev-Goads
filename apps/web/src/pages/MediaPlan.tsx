import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import PolluxaHeader from "../components/PolluxaHeader.js";
import FormattedMessage from "../components/FormattedMessage.js";
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

interface ChatSession {
  id: string;
  startedAt: number;
  preview: string;
  messages: ChatMessage[];
}

const HISTORY_KEY_PREFIX = "polluxa-strategist-history:";
const MAX_HISTORY_SESSIONS = 20;

function loadSessions(businessId: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY_PREFIX + businessId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(businessId: string, sessions: ChatSession[]) {
  try {
    localStorage.setItem(HISTORY_KEY_PREFIX + businessId, JSON.stringify(sessions.slice(0, MAX_HISTORY_SESSIONS)));
  } catch {
    // Storage full/unavailable (e.g. private browsing) — history just won't persist.
  }
}

function formatRelativeTime(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function toHistory(messages: ChatMessage[]): StrategistChatMessage[] {
  return messages.map((m) => ({ role: m.sender === "user" ? ("user" as const) : ("assistant" as const), content: m.text }));
}

export default function MediaPlan({ businessId }: { businessId: string }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("Performance");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedHistory, setFailedHistory] = useState<StrategistChatMessage[] | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions(businessId));
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessions(loadSessions(businessId));
  }, [businessId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    if (!showHistory) return;
    function handleClickOutside(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showHistory]);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function sendToStrategist(history: StrategistChatMessage[]) {
    setError(null);
    setIsSending(true);
    try {
      const { reply } = await api.chatWithStrategist(businessId, history);
      setMessages((prev) => [...prev, { id: `msg-${prev.length}-s`, sender: "strategist", text: reply }]);
      setFailedHistory(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong reaching the strategist.");
      setFailedHistory(history);
    } finally {
      setIsSending(false);
    }
  }

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    const history = [...toHistory(messages), { role: "user" as const, content: trimmed }];
    setMessages((prev) => [...prev, { id: `msg-${prev.length}-u`, sender: "user", text: trimmed }]);
    setInputValue("");
    requestAnimationFrame(resizeTextarea);
    await sendToStrategist(history);
  }

  function handleRetry() {
    if (failedHistory) sendToStrategist(failedHistory);
  }

  function handleNewChat() {
    if (messages.length > 0) {
      const archived: ChatSession = {
        id: `session-${Date.now()}`,
        startedAt: Date.now(),
        preview: messages[0].text.slice(0, 60),
        messages
      };
      const next = [archived, ...sessions].slice(0, MAX_HISTORY_SESSIONS);
      setSessions(next);
      saveSessions(businessId, next);
    }
    setMessages([]);
    setError(null);
    setFailedHistory(null);
  }

  function handleLoadSession(session: ChatSession) {
    setMessages(session.messages);
    setError(null);
    setFailedHistory(null);
    setShowHistory(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputValue);
    }
  }

  return (
    <div className="page-media-plan">
      <PolluxaHeader breadcrumb={["Media Plan"]} />

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
            Your Media Plan will come to life once your ads are running. Create and publish a campaign — CRM Ads will
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
              <span>CRM Ads starts syncing performance data every hour</span>
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
            <span className="media-plan-chat-title-group">
              <span className="media-plan-chat-avatar">🧠</span>
              <span className="media-plan-chat-title-text">
                <span className="media-plan-chat-title">Chat with Strategist</span>
                <span className="media-plan-chat-subtitle">
                  <span className={`media-plan-status-dot ${isSending ? "busy" : ""}`} aria-hidden="true" />
                  {isSending ? "Thinking..." : "Grounded in your account data"}
                </span>
              </span>
            </span>
            <div className="media-plan-chat-header-actions" ref={historyRef}>
              <button className="media-plan-icon-btn" aria-label="New chat" onClick={handleNewChat}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button
                className="media-plan-icon-btn"
                aria-label="Chat history"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15.5 14" />
                </svg>
              </button>

              {showHistory && (
                <div className="media-plan-chat-history-dropdown">
                  {sessions.length === 0 ? (
                    <div className="media-plan-chat-history-empty">No past conversations yet.</div>
                  ) : (
                    sessions.map((s) => (
                      <button key={s.id} className="media-plan-chat-history-item" onClick={() => handleLoadSession(s)}>
                        <span className="media-plan-chat-history-item-text">{s.preview || "Conversation"}</span>
                        <span className="media-plan-chat-history-item-time">{formatRelativeTime(s.startedAt)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="media-plan-chat-body">
            {messages.length === 0 ? (
              <div className="media-plan-chat-empty">
                <span className="media-plan-chat-empty-icon">🧠</span>
                <p>
                  Ask the strategist to generate, revise or evaluate a Media Plan, or set long-term brand
                  preferences.
                </p>
                <div className="media-plan-chat-empty-capabilities">
                  <span className="media-plan-capability-chip">📊 Evaluate performance</span>
                  <span className="media-plan-capability-chip">🗺️ Build a media plan</span>
                  <span className="media-plan-capability-chip">🎯 Set brand preferences</span>
                </div>
              </div>
            ) : (
              <div className="media-plan-chat-messages">
                {messages.map((m) => (
                  <div key={m.id} className={`media-plan-message-row ${m.sender}`}>
                    {m.sender === "strategist" && <span className="media-plan-message-avatar" aria-hidden="true">🧠</span>}
                    <div className={`media-plan-chat-bubble ${m.sender}`}>
                      {m.sender === "strategist" ? <FormattedMessage text={m.text} /> : m.text}
                    </div>
                  </div>
                ))}
                {isSending && (
                  <div className="media-plan-message-row strategist">
                    <span className="media-plan-message-avatar" aria-hidden="true">🧠</span>
                    <div className="media-plan-chat-bubble strategist typing">
                      <span className="media-plan-typing-dot" />
                      <span className="media-plan-typing-dot" />
                      <span className="media-plan-typing-dot" />
                    </div>
                  </div>
                )}
                {error && (
                  <div className="media-plan-chat-error">
                    <span>{error}</span>
                    {failedHistory && (
                      <button className="media-plan-retry-btn" onClick={handleRetry}>
                        Retry
                      </button>
                    )}
                  </div>
                )}
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
              placeholder="Ask the strategist..."
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
