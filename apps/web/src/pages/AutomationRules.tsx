import { useState } from "react";
import Reveal from "../components/Reveal.js";

interface AutomationRule {
  id: string;
  name: string;
  triggerMetric: "CPA" | "CTR" | "ROAS" | "Spend";
  operator: ">" | "<" | "=";
  threshold: number;
  action: "Pause Campaign" | "Increase Budget" | "Duplicate Campaign" | "Notify Team";
  actionValue?: string;
  cooldown: string;
  priority: "High" | "Medium" | "Low";
  enabled: boolean;
}

const DEFAULT_RULES: AutomationRule[] = [
  {
    id: "rule-1",
    name: "Pause High CPA Campaigns",
    triggerMetric: "CPA",
    operator: ">",
    threshold: 40,
    action: "Pause Campaign",
    cooldown: "24h",
    priority: "High",
    enabled: true
  },
  {
    id: "rule-2",
    name: "Reward High CTR Creatives",
    triggerMetric: "CTR",
    operator: ">",
    threshold: 5,
    action: "Increase Budget",
    actionValue: "20%",
    cooldown: "12h",
    priority: "Medium",
    enabled: true
  },
  {
    id: "rule-3",
    name: "Scale Winning Ads (ROAS)",
    triggerMetric: "ROAS",
    operator: ">",
    threshold: 6,
    action: "Duplicate Campaign",
    cooldown: "48h",
    priority: "High",
    enabled: false
  }
];

export default function AutomationRules({ businessId }: { businessId: string }) {
  const [rules, setRules] = useState<AutomationRule[]>(DEFAULT_RULES);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Rule builder states
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<AutomationRule["triggerMetric"]>("CPA");
  const [operator, setOperator] = useState<AutomationRule["operator"]>(">");
  const [threshold, setThreshold] = useState<number>(0);
  const [action, setAction] = useState<AutomationRule["action"]>("Pause Campaign");
  const [actionValue, setActionValue] = useState("");
  const [cooldown, setCooldown] = useState("24h");
  const [priority, setPriority] = useState<AutomationRule["priority"]>("Medium");

  function handleToggle(id: string) {
    setRules(prev =>
      prev.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  }

  function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const newRule: AutomationRule = {
      id: `rule-${Date.now()}`,
      name,
      triggerMetric: metric,
      operator,
      threshold,
      action,
      actionValue: actionValue || undefined,
      cooldown,
      priority,
      enabled: true
    };

    setRules(prev => [...prev, newRule]);
    // reset form
    setName("");
    setMetric("CPA");
    setOperator(">");
    setThreshold(0);
    setAction("Pause Campaign");
    setActionValue("");
    setCooldown("24h");
    setPriority("Medium");
    setShowAddForm(false);
    alert("Automation optimization rule created successfully.");
  }

  function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this rule?")) return;
    setRules(prev => prev.filter(r => r.id !== id));
  }

  return (
    <div className="page-rules">
      <div className="page-header">
        <div>
          <h1>AI Automation Rules</h1>
          <p className="subtitle">Set up triggers to automatically manage budgets, pause campaigns, or duplicate high performers.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? "Close Form" : "+ Create Rule"}
        </button>
      </div>

      {showAddForm && (
        <section className="card mb-4 creative-create-card">
          <h2>Create Optimization Rule</h2>
          <form onSubmit={handleAddRule} className="creative-form mt-3">
            <label>
              Rule Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Budget Cap for Low ROI"
                required
              />
            </label>

            <div className="form-row-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginTop: "12px" }}>
              <label>
                Trigger Metric
                <select value={metric} onChange={(e) => setMetric(e.target.value as any)}>
                  <option value="CPA">CPA (Cost Per Acquisition)</option>
                  <option value="CTR">CTR (Click-Through Rate)</option>
                  <option value="ROAS">ROAS (Return on Ad Spend)</option>
                  <option value="Spend">Spend (Total budget spent)</option>
                </select>
              </label>

              <label>
                Condition
                <select value={operator} onChange={(e) => setOperator(e.target.value as any)}>
                  <option value=">">Is Greater Than (&gt;)</option>
                  <option value="<">Is Less Than (&lt;)</option>
                  <option value="=">Equals (=)</option>
                </select>
              </label>

              <label>
                Threshold Value
                <input
                  type="number"
                  step="any"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  required
                />
              </label>
            </div>

            <div className="form-row-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginTop: "12px" }}>
              <label>
                Action Output
                <select value={action} onChange={(e) => setAction(e.target.value as any)}>
                  <option value="Pause Campaign">Pause Campaign</option>
                  <option value="Increase Budget">Scale Budget (+%)</option>
                  <option value="Duplicate Campaign">Duplicate Campaign</option>
                  <option value="Notify Team">Send Alert Notification</option>
                </select>
              </label>

              <label>
                Action Parameter (e.g. 20%)
                <input
                  type="text"
                  value={actionValue}
                  onChange={(e) => setActionValue(e.target.value)}
                  placeholder="e.g. 20% (optional)"
                />
              </label>

              <label>
                Cooldown Period
                <select value={cooldown} onChange={(e) => setCooldown(e.target.value)}>
                  <option value="12h">12 Hours Cooldown</option>
                  <option value="24h">24 Hours Cooldown</option>
                  <option value="48h">48 Hours Cooldown</option>
                  <option value="7d">7 Days Cooldown</option>
                </select>
              </label>
            </div>

            <label className="mt-3">
              Rule Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
                <option value="Low">Low Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="High">High Priority</option>
              </select>
            </label>

            <button className="btn btn-primary mt-4" type="submit">
              Save Automation Rule
            </button>
          </form>
        </section>
      )}

      <Reveal>
        <div className="monitoring-grid">
          {rules.map((r) => (
            <div key={r.id} className="card rule-card">
              <div className="rule-card-header">
                <span className="rule-name">{r.name}</span>
                <span className="rule-meta-tag">{r.priority} Priority</span>
              </div>
              
              <div className="flex-col gap-2 mt-2 font-size-13" style={{ color: "#4b5563" }}>
                <div>
                  Trigger Condition: <strong style={{ color: "#111827" }}>{r.triggerMetric} {r.operator} {r.triggerMetric === "CPA" ? `$${r.threshold}` : r.triggerMetric === "CTR" ? `${r.threshold}%` : r.threshold}</strong>
                </div>
                <div>
                  Action Executed: <strong style={{ color: "#7033f5" }}>{r.action} {r.actionValue ? `(${r.actionValue})` : ""}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                  <span>Cooldown: <strong>{r.cooldown}</strong></span>
                  <span>State: <strong style={{ color: r.enabled ? "#10b981" : "#9ca3af" }}>{r.enabled ? "Active" : "Paused"}</strong></span>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  className="btn btn-sm btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => handleToggle(r.id)}
                >
                  {r.enabled ? "⏸ Pause Rule" : "▶ Activate Rule"}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(r.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
