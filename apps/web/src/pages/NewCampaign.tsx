import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";

const AVATAR_EMOJIS = ["🤖", "👨", "👩", "👩‍🦰", "🧑", "👩🏾"];

const RESEARCH_STAGES = [
  "Fetching page…",
  "Crawling linked pages…",
  "Analyzing product & brand tone…",
  "Building audience profile…",
];

export default function NewCampaign() {
  const navigate = useNavigate();
  const [pageUrl, setPageUrl] = useState("");
  const [researching, setResearching] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleDeepResearch() {
    const url = pageUrl.trim();
    if (!url) {
      setError("Please enter a page URL to continue.");
      return;
    }
    setError(null);
    setResearching(true);
    setStage(0);
    const stageTimer = setInterval(() => setStage((s) => Math.min(s + 1, RESEARCH_STAGES.length - 1)), 1400);
    try {
      const result = await api.deepResearch(url);
      sessionStorage.setItem("adgo_deep_research", JSON.stringify({ url, ...result }));
      navigate("/wizard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't research that page — check the URL and try again.");
    } finally {
      clearInterval(stageTimer);
      setResearching(false);
    }
  }

  return (
    <div className="page-new-campaign">
      <div className="page-header">
        <div>
          <h1>New Campaign</h1>
        </div>
      </div>

      <a className="how-to-use-link" href="#" onClick={(e) => e.preventDefault()}>
        <span className="how-to-use-icon" aria-hidden="true">📖</span>
        How to use?
      </a>

      <div className="new-campaign-hero">
        <div className="new-campaign-avatars">
          {AVATAR_EMOJIS.map((emoji, i) => (
            <span key={i} className={`new-campaign-avatar ${i === 0 ? "new-campaign-avatar-bot" : ""}`}>
              {emoji}
            </span>
          ))}
        </div>

        <h2 className="new-campaign-question">
          <span className="new-campaign-word-light">Which</span>{" "}
          <span className="new-campaign-word-accent">page</span> would you like to promote?
        </h2>
        <p className="new-campaign-subtext">
          No landing page? No problem — you can use a social media page or any page that
          shows your product. Paste your link below to get started.
        </p>

        {error && <p className="error">{error}</p>}

        <div className="new-campaign-url-row">
          <input
            type="text"
            className="new-campaign-url-input"
            placeholder="Please enter page url"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDeepResearch()}
          />
          <button
            className="btn btn-primary new-campaign-deep-research-btn"
            onClick={handleDeepResearch}
            disabled={researching}
          >
            <span aria-hidden="true">✨</span>
            {researching ? "Researching…" : "Deep Research"}
          </button>
        </div>

        {researching && (
          <div className="new-campaign-research-progress">
            <div className="onboarding-spinner" />
            <span>{RESEARCH_STAGES[stage]}</span>
          </div>
        )}
      </div>
    </div>
  );
}
