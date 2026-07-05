import { Link } from "react-router-dom";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import BackToTop from "../components/BackToTop.js";
import Reveal from "../components/Reveal.js";

const SCENARIOS = [
  {
    title: "E-commerce: reallocating spend mid-campaign",
    body:
      "A hypothetical walkthrough of what the optimization engine does when one creative variant starts converting well above the others — it increases that variant's budget, keeps a small exploration slot on the rest, and pauses anything whose cost per acquisition drifts too far from the pack.",
  },
  {
    title: "Local services: launching across two networks at once",
    body:
      "A hypothetical walkthrough of onboarding a local business, generating a strategy split across Google and Meta, and watching the campaign orchestrator launch matching variants on both networks from one approval.",
  },
];

export default function Resources() {
  return (
    <div className="landing">
      <SiteNav />
      <section className="hero hero-compact">
        <span className="eyebrow">Resources</span>
        <h1>How AdGo actually works</h1>
        <p className="lead">
          This project doesn't have real customers yet, so instead of fabricated case studies, here are honest
          walkthroughs of what the built system does, plus the{" "}
          <Link to="/blog">blog</Link> for shorter write-ups.
        </p>
      </section>

      <section className="section">
        <div className="benefits-grid">
          {SCENARIOS.map((s, i) => (
            <Reveal delay={i * 60} key={s.title}>
              <div className="benefit-card">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <span className="hero-note">Illustrative scenario, not a real customer result.</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="cta-banner">
        <Reveal>
          <div className="cta-banner-inner">
            <h2>See the real system behind these walkthroughs</h2>
            <p>No credit card required to try the full flow.</p>
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
