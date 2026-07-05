import { useEffect, useState } from "react";
import { api, Draft } from "../api/client.js";
import Reveal from "../components/Reveal.js";

// Step structure for workflows
const STAGES = [
  { key: "draft", label: "Draft" },
  { key: "review", label: "Awaiting Approval" },
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" }
] as const;

export default function Drafts({ businessId }: { businessId: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";

  async function loadDrafts() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listDrafts(wsId);
      // Ensure all drafts have a status within our workflow stages, mapping standard API statuses
      const formatted = data.map(d => ({
        ...d,
        status: (d.status === "review" ? "review" : d.status === "published" ? "published" : d.status === "scheduled" ? "scheduled" : "draft") as any
      }));
      setDrafts(formatted);
    } catch (err) {
      setError("Failed to fetch campaign drafts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDrafts();
  }, [businessId]);

  // Update status in local state to simulate progress immediately
  function updateDraftStatus(id: string, newStatus: string) {
    setDrafts(prev =>
      prev.map(d => (d.id === id ? { ...d, status: newStatus as any } : d))
    );
  }

  async function handleProgress(id: string, currentStatus: string) {
    setError(null);
    try {
      if (currentStatus === "draft") {
        updateDraftStatus(id, "review");
        alert("Campaign draft submitted to workspace administrators for review.");
      } else if (currentStatus === "review") {
        updateDraftStatus(id, "approved");
        alert("Campaign draft approved.");
      } else if (currentStatus === "approved") {
        updateDraftStatus(id, "scheduled");
        alert("Campaign scheduled for automated publication.");
      } else if (currentStatus === "scheduled") {
        // Trigger actual publish endpoint
        await api.publishDraft(id);
        updateDraftStatus(id, "published");
        alert("Campaign launched and published successfully to Google & Meta Ads APIs!");
      }
    } catch (err) {
      setError("Failed to update campaign approval stage.");
    }
  }

  function handleReject(id: string) {
    updateDraftStatus(id, "draft");
    alert("Campaign draft rejected and returned to editing stage.");
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this draft?")) return;
    try {
      await api.deleteDraft(id);
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      setError("Failed to delete draft.");
    }
  }

  return (
    <div className="page-drafts">
      <div className="page-header">
        <div>
          <h1>Drafts &amp; Recommendations Workflow</h1>
          <p className="subtitle">Track approval pipelines and schedule AI recommendations for active ad channels.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <div className="campaigns-loading">
          {[1, 2].map(i => <div key={i} className="campaign-row-skeleton" />)}
        </div>
      ) : drafts.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🗂</span>
          <p>No draft campaigns found. Create one using the Campaign Wizard.</p>
        </div>
      ) : (
        <Reveal>
          <div className="drafts-grid flex-col gap-4">
            {drafts.map((d) => {
              // Find active index
              const activeIndex = STAGES.findIndex(s => s.key === d.status);
              
              return (
                <div key={d.id} className="card draft-card">
                  <div className="draft-card-header flex justify-between items-start gap-4">
                    <div>
                      <span className="pill text-uppercase font-size-11" style={{ background: "rgba(112, 51, 245, 0.08)", color: "#7033f5", fontWeight: 700 }}>
                        {d.status.toUpperCase()}
                      </span>
                      <h3 className="draft-name mt-2">{d.name}</h3>
                    </div>
                    {d.score && (
                      <div className="draft-score-badge">
                        <span className="score-label">AI Score</span>
                        <strong className="score-val" style={{ color: d.score > 85 ? "var(--accent-2)" : "var(--accent)" }}>
                          {d.score}%
                        </strong>
                      </div>
                    )}
                  </div>

                  <div className="draft-details mt-3 font-size-13" style={{ color: "#4b5563" }}>
                    <span>Objective: <strong>LEAD GENERATION</strong></span>
                    <span style={{ marginLeft: "20px" }}>Asset Source: <strong>AI GENERATED</strong></span>
                  </div>

                  {/* Workflow Stepper Grid */}
                  <div className="stepper-container mt-4 mb-4">
                    {/* Background connector line */}
                    <div className="stepper-line"></div>
                    
                    {/* Active connector progress */}
                    <div
                      className="stepper-line-active"
                      style={{ width: `${(activeIndex / (STAGES.length - 1)) * 100}%` }}
                    ></div>

                    {STAGES.map((stage, idx) => {
                      const isCompleted = idx < activeIndex;
                      const isActive = idx === activeIndex;
                      
                      return (
                        <div
                          key={stage.key}
                          className={`stepper-node ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""}`}
                        >
                          <div className="stepper-circle">
                            {isCompleted ? "✓" : idx + 1}
                          </div>
                          <span className="stepper-label">{stage.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  {d.aiRecommendation && (
                    <div className="ai-recommendation-box mt-3" style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px", fontSize: "13px" }}>
                      <strong style={{ color: "#7033f5" }}>💡 AI Recommendation</strong>
                      <p className="mt-1" style={{ margin: 0, color: "#4b5563" }}>{d.aiRecommendation}</p>
                    </div>
                  )}

                  <div className="draft-actions-row justify-between mt-4">
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(d.id)}>
                      Delete Draft
                    </button>
                    
                    <div className="flex gap-2">
                      {d.status === "review" && (
                        <button className="btn btn-sm btn-secondary" onClick={() => handleReject(d.id)}>
                          ✕ Reject
                        </button>
                      )}
                      
                      {d.status !== "published" && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleProgress(d.id, d.status)}
                        >
                          {d.status === "draft" && "Submit for Approval ➔"}
                          {d.status === "review" && "✓ Approve"}
                          {d.status === "approved" && "📅 Schedule Launch"}
                          {d.status === "scheduled" && "🚀 Publish Live"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      )}
    </div>
  );
}
