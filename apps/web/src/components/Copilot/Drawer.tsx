import { useState, useRef, useEffect } from "react";
import { useCopilot } from "../../providers/CopilotProvider.js";

const SUGGESTIONS = [
  "Increase my budget.",
  "Show poor performers.",
  "Generate five new headlines.",
  "Pause Meta campaigns.",
  "Compare this month.",
  "Explain why CTR dropped."
];

export default function CopilotDrawer() {
  const { isOpen, status, messages, closeCopilot, sendMessage, clearChat } = useCopilot();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function handleSend(text: string) {
    if (!text.trim()) return;
    setInputValue("");
    await sendMessage(text);
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSend(inputValue);
    }
  }

  return (
    <div className={`copilot-drawer ${isOpen ? "open" : ""}`}>
      {/* Header */}
      <div className="copilot-header">
        <span className="copilot-header-title">
          <span className="copilot-header-icon">✨</span>
          AdsGo AI Copilot
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn btn-sm btn-secondary" style={{ fontSize: "10px", padding: "4px 8px" }} onClick={clearChat}>
            Clear
          </button>
          <button className="copilot-close-btn" onClick={closeCopilot} aria-label="Close copilot">
            ×
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="copilot-messages-container">
        {messages.map((m) => (
          <div key={m.id} className={`copilot-message-bubble ${m.sender}`}>
            {/* Format markdown newlines and lists simple split */}
            {m.text.split("\n").map((para, i) => {
              if (para.startsWith("* ")) {
                return (
                  <ul key={i} style={{ margin: "2px 0", paddingLeft: "15px" }}>
                    <li>{para.substring(2)}</li>
                  </ul>
                );
              }
              return <p key={i} style={{ margin: "4px 0" }}>{para}</p>;
            })}
            <span style={{ fontSize: "9px", opacity: 0.6, display: "block", marginTop: "4px", textAlign: "right" }}>
              {m.timestamp}
            </span>
          </div>
        ))}

        {/* Dynamic status indicators */}
        {status === "Thinking" && (
          <div className="copilot-message-bubble copilot">
            <span className="font-size-11 block muted-text">Thinking...</span>
            <div className="copilot-typing-indicator mt-1">
              <div className="copilot-typing-dot" />
              <div className="copilot-typing-dot" />
              <div className="copilot-typing-dot" />
            </div>
          </div>
        )}

        {status === "ToolExecution" && (
          <div className="copilot-message-bubble copilot" style={{ borderColor: "#d3c4ff", background: "#fdfcff" }}>
            <span className="font-size-11 block" style={{ color: "#7033f5", fontWeight: 600 }}>🛠️ Running campaigns tool analysis...</span>
            <div className="copilot-typing-indicator mt-1">
              <div className="copilot-typing-dot" style={{ backgroundColor: "#7033f5" }} />
              <div className="copilot-typing-dot" style={{ backgroundColor: "#7033f5" }} />
              <div className="copilot-typing-dot" style={{ backgroundColor: "#7033f5" }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion Chips */}
      <div className="copilot-suggestions-container">
        <span className="suggestions-title">How can I help?</span>
        <div className="suggestions-chips">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="suggestion-chip"
              disabled={status === "Thinking" || status === "ToolExecution"}
              onClick={() => handleSend(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="copilot-input-container">
        <input
          type="text"
          className="copilot-input"
          placeholder="Ask Copilot to pause, optimize, copywrite..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyPress}
          disabled={status === "Thinking" || status === "ToolExecution"}
        />
        <button
          className="copilot-send-btn"
          onClick={() => handleSend(inputValue)}
          disabled={status === "Thinking" || status === "ToolExecution"}
        >
          Send
        </button>
      </div>
    </div>
  );
}
