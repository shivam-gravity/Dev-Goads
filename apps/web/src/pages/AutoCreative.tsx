import { Link } from "react-router-dom";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import BackToTop from "../components/BackToTop.js";
import Reveal from "../components/Reveal.js";

const AUTO_CREATIVE_FEATURES = [
  {
    title: "Headline generation",
    body: "Claude drafts headline, body, and call-to-action combinations grounded in your business description and stated goals — not generic templates.",
  },
  {
    title: "Performance-aware regeneration",
    body: "Each creative carries a rolling performance score from the optimization engine. Low scorers get replaced; the traits of high scorers inform what's generated next.",
  },
  {
    title: "Per-network formatting",
    body: "The same creative concept is adapted to fit Google Ads and Meta ad formats through their respective adapters — no manual resizing or rewriting.",
  },
  {
    title: "Human review before launch",
    body: "Every generated creative sits in a draft/review state until you approve it — nothing publishes without a look first.",
  },
];

export default function AutoCreative() {
  return (
    <div className="landing">
      <SiteNav />
      <section className="hero hero-compact">
        <span className="eyebrow">Feature — Auto Creative</span>
        <h1>
          Ad copy that <span className="highlight">writes itself</span>, then improves itself
        </h1>
        <p className="lead">
          Every strategy ships with 2–4 creative variants. Polluxa tracks which ones actually convert and biases the
          next round of generation toward that pattern.
        </p>
      </section>

      <section className="section">
        <div className="benefits-grid">
          {AUTO_CREATIVE_FEATURES.map((f, i) => (
            <Reveal delay={i * 60} key={f.title}>
              <div className="benefit-card">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="cta-banner">
        <Reveal>
          <div className="cta-banner-inner">
            <h2>Generate your first set of creatives</h2>
            <p>See real output from your own business description.</p>
            <Link to="/get-started" className="btn btn-primary btn-lg">
              Get started free
            </Link>
          </div>
        </Reveal>
      </section>

      <BackToTop />

      <SiteFooter />
    </div>
  );
}
