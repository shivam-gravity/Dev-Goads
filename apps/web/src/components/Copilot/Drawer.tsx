import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent } from "react";
import { useCopilot } from "../../providers/CopilotProvider.js";
import FormattedMessage from "../FormattedMessage.js";

const SUGGESTIONS = [
  "Increase my budget.",
  "Show poor performers.",
  "Generate five new headlines.",
  "Pause Meta campaigns.",
  "Compare this month.",
  "Explain why CTR dropped."
];

const BUSY_STATUSES = new Set(["Thinking", "ToolExecution", "Streaming"]);

export default function CopilotDrawer() {
  const { isOpen, status, messages, canRetry, closeCopilot, sendMessage, retryLast, clearChat } = useCopilot();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const busy = BUSY_STATUSES.has(status);
  const isEmpty = messages.length <= 1;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (isOpen) textareaRef.current?.focus();
  }, [isOpen]);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  async function handleSend(text: string) {
    if (!text.trim() || busy) return;
    setInputValue("");
    requestAnimationFrame(resizeTextarea);
    await sendMessage(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputValue);
    }
  }

  return (
    <>
      <div className={`copilot-backdrop ${isOpen ? "open" : ""}`} onClick={closeCopilot} aria-hidden="true" />
      <div className={`copilot-drawer ${isOpen ? "open" : ""}`} role="dialog" aria-label="CRM Ads AI Copilot" aria-hidden={!isOpen}>
      <div className="copilot-header">
        <span className="copilot-header-title">
          <span className="copilot-header-avatar">✨</span>
          <span className="copilot-header-text">
            <span className="copilot-header-name">CRM Ads Copilot</span>
            <span className="copilot-header-subtitle">
              <span className={`copilot-status-dot ${busy ? "busy" : ""}`} aria-hidden="true" />
              {busy ? "Working..." : "Grounded in your live data"}
            </span>
          </span>
        </span>
        <div className="copilot-header-actions">
          <button className="copilot-icon-btn" onClick={clearChat} aria-label="Start a new chat" title="New chat">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button className="copilot-icon-btn copilot-close-btn" onClick={closeCopilot} aria-label="Close copilot">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="copilot-messages-container">
        {isEmpty && (
          <div className="copilot-empty-state">
            <span className="copilot-empty-icon">✨</span>
            <p className="copilot-empty-text">{messages[0]?.text}</p>
            <div className="copilot-empty-capabilities">
              <span className="copilot-capability-chip">📊 Analyze performance</span>
              <span className="copilot-capability-chip">🎯 Flag poor performers</span>
              <span className="copilot-capability-chip">✍️ Draft ad copy</span>
              <span className="copilot-capability-chip">💰 Recommend budget shifts</span>
            </div>
          </div>
        )}

        {!isEmpty && messages.map((m) => (
          <div key={m.id} className={`copilot-message-row ${m.sender}`}>
            {m.sender === "copilot" && <span className="copilot-avatar" aria-hidden="true">{m.isError ? "⚠️" : "✨"}</span>}
            <div className={`copilot-message-bubble ${m.sender} ${m.isError ? "error" : ""}`}>
              <FormattedMessage text={m.text} />
              <span className="copilot-message-time">{m.timestamp}</span>
              {m.isError && canRetry && m.id === messages[messages.length - 1].id && (
                <button className="copilot-retry-btn" onClick={() => retryLast()}>
                  Try again
                </button>
              )}
            </div>
          </div>
        ))}

        {(status === "Thinking" || status === "ToolExecution") && (
          <div className="copilot-message-row copilot">
            <span className="copilot-avatar" aria-hidden="true">✨</span>
            <div className="copilot-message-bubble copilot copilot-status-bubble">
              <span className="copilot-status-label">
                {status === "Thinking" ? "Thinking…" : "Analyzing your campaign data…"}
              </span>
              <div className="copilot-typing-indicator">
                <div className="copilot-typing-dot" />
                <div className="copilot-typing-dot" />
                <div className="copilot-typing-dot" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="copilot-suggestions-container">
        <span className="suggestions-title">Try asking</span>
        <div className="suggestions-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion-chip" disabled={busy} onClick={() => handleSend(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="copilot-input-container">
        <textarea
          ref={textareaRef}
          className="copilot-input"
          placeholder="Ask Copilot about spend, performance, or copy…"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); resizeTextarea(); }}
          onKeyDown={handleKeyDown}
          disabled={busy}
          rows={1}
        />
        <button
          className="copilot-send-btn"
          onClick={() => handleSend(inputValue)}
          disabled={busy || !inputValue.trim()}
          aria-label="Send message"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
          </svg>
        </button>
      </div>
      </div>
    </>
  );
}
