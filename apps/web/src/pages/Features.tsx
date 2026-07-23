import { Link } from "react-router-dom";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import BackToTop from "../components/BackToTop.js";
import Reveal from "../components/Reveal.js";

const FEATURES = [
  {
    title: "AI strategy engine",
    body: "Describe your business and goals; Claude proposes recommended ad networks, a budget split, target audiences, and creative angles before you spend anything.",
  },
  {
    title: "Auto Creative",
    body: "Ad copy and creative variants generated per audience segment, with a rolling performance score that biases future variants toward what's already working.",
  },
  {
    title: "Campaign orchestrator",
    body: "One click builds and launches every creative × network combination through the live Google Ads and Meta Marketing APIs.",
  },
  {
    title: "Optimization engine",
    body: "An epsilon-greedy bandit reviews performance per variant, shifts budget toward the best performer, keeps exploring the rest, and pauses high-CPA variants automatically.",
  },
  {
    title: "Performance dashboard",
    body: "Impressions, clicks, conversions, CTR, and CPA per variant, normalized across networks into one view.",
  },
  {
    title: "Usage-based billing",
    body: "A flat monthly fee plus a percentage of ad spend CRM Ads manages, invoiced automatically from real recorded spend.",
  },
];

export default function Features() {
  return (
    <div className="landing">
      <SiteNav />
      <section className="hero hero-compact">
        <span className="eyebrow">Features</span>
        <h1>Everything CRM Ads automates, end to end</h1>
        <p className="lead">
          From the first strategy draft to the invoice at the end of the month — here's what's actually built and
          running under the hood.
        </p>
      </section>

      <section className="section">
        <div className="benefits-grid">
          {FEATURES.map((f, i) => (
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
            <h2>See it generate a real strategy</h2>
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
