import { useState } from "react";
import Reveal from "../components/Reveal.js";

const FAQS = [
  { q: "How does the AI optimize budgets?", a: "AdGo uses multi-armed bandit algorithms to analyze variants with high Click-Through Rates (CTR) and low Cost Per Acquisition (CPA). It automatically sets budgets toward Meta or Google variants to capture higher Return on Ad Spend (ROAS)." },
  { q: "Is meta pixel installation automatic?", a: "Pixel conversion event tracking requires connecting your Meta Ads Manager. Once connected, AdGo syncs conversion payloads automatically via standard API conversion feeds." },
  { q: "Can I connect multiple ad accounts?", a: "Yes, you can connect multiple Meta/Google ad accounts and store profiles under Workspace settings. Navigate to Admin → Workspace to switch or invite owners." }
];

export default function HelpCenter() {
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketBody, setTicketBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [faqSearch, setFaqSearch] = useState("");

  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  function handleSubmitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketSubject.trim() || !ticketBody.trim()) return;
    setSubmitting(true);
    setTimeout(() => {
      alert("Support ticket created. Our AI engineer or support agent will reply within 4 hours.");
      setTicketSubject("");
      setTicketBody("");
      setSubmitting(false);
    }, 1200);
  }

  const filteredFaqs = FAQS.filter(
    f => f.q.toLowerCase().includes(faqSearch.toLowerCase()) || f.a.toLowerCase().includes(faqSearch.toLowerCase())
  );

  return (
    <div className="page-help">
      <div className="page-header">
        <div>
          <h1>Help Center</h1>
          <p className="subtitle">Learn how to configure campaigns, scale budgets, and connect external pixels.</p>
        </div>
      </div>

      <div className="help-layout">
        {/* Left column: Documentation & FAQs */}
        <div className="help-docs flex-col gap-4">
          <section className="card">
            <h2>Frequently Asked Questions</h2>
            <input
              type="text"
              value={faqSearch}
              onChange={(e) => setFaqSearch(e.target.value)}
              placeholder="Search help topics..."
              className="search-input mt-3 mb-3"
            />

            <div className="faq-list">
              {filteredFaqs.map((faq, idx) => {
                const isOpen = activeFaq === idx;
                return (
                  <div key={idx} className={`faq-item-accordion ${isOpen ? "open" : ""}`} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0" }}>
                    <button
                      className="faq-question-btn"
                      onClick={() => setActiveFaq(isOpen ? null : idx)}
                      style={{ background: "none", border: "none", width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", cursor: "pointer", fontWeight: 600, color: "var(--text)", padding: 0, boxShadow: "none" }}
                    >
                      <span>{faq.q}</span>
                      <span>{isOpen ? "▲" : "▼"}</span>
                    </button>
                    {isOpen && (
                      <Reveal>
                        <p className="faq-answer-text mt-2 font-size-13" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
                          {faq.a}
                        </p>
                      </Reveal>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h2>Onboarding Guides</h2>
            <div className="guides-grid mt-3">
              {[
                { title: "Meta Pixel Integration", length: "4 min read", desc: "Complete walkthrough on installing and verifying the Meta Ads Conversion Pixel on custom web hosts." },
                { title: "Google Search Dayparting", length: "5 min read", desc: "Learn how to optimize search bids based on peak conversion hours during the weekdays." }
              ].map(g => (
                <div key={g.title} className="guide-card-snippet" style={{ padding: "14px", border: "1.5px solid var(--border)", borderRadius: "8px", background: "var(--surface-tint)" }}>
                  <div className="flex justify-between font-size-11 color-accent font-weight-700">
                    <span>GUIDE</span>
                    <span>{g.length}</span>
                  </div>
                  <strong className="mt-2 block">{g.title}</strong>
                  <p className="muted-text font-size-12 mt-1">{g.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right column: Create support ticket */}
        <div className="help-support-form">
          <section className="card">
            <h2>Create Support Ticket</h2>
            <form onSubmit={handleSubmitTicket} className="wizard-form mt-3">
              <label>
                Topic Subject
                <input
                  type="text"
                  value={ticketSubject}
                  onChange={(e) => setTicketSubject(e.target.value)}
                  placeholder="e.g. Meta Sync connection failed"
                  required
                />
              </label>
              <label>
                Message / Description
                <textarea
                  value={ticketBody}
                  onChange={(e) => setTicketBody(e.target.value)}
                  placeholder="Provide details about the issue..."
                  rows={5}
                  required
                />
              </label>
              <button className="btn btn-primary btn-full mt-4" type="submit" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Ticket"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
