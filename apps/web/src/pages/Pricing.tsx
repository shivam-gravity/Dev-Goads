import { Link } from "react-router-dom";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import BackToTop from "../components/BackToTop.js";
import Reveal from "../components/Reveal.js";

const FAQ_ITEMS = [
  {
    q: "Is there a setup fee?",
    a: "No. The flat monthly fee and the percentage of managed spend are the only charges.",
  },
  {
    q: "What counts as \"managed ad spend\"?",
    a: "Spend recorded on campaigns Polluxa has launched and is actively optimizing, pulled directly from the connected Google Ads and Meta accounts.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes — disconnecting your ad accounts stops management immediately; there's no contract.",
  },
];

export default function Pricing() {
  return (
    <div className="landing">
      <SiteNav />
      <section className="hero hero-compact">
        <span className="eyebrow">Pricing</span>
        <h1>One plan. No contracts.</h1>
        <p className="lead">A flat base fee plus a percentage of the ad spend Polluxa actually manages for you.</p>
      </section>

      <section className="section">
        <Reveal>
          <div className="pricing-card border-beam">
            <div className="pill">Platform fee</div>
            <div className="price">
              $49<span>/mo + 12% of managed ad spend</span>
            </div>
            <ul>
              <li>AI-generated strategy and creatives</li>
              <li>Launch and manage campaigns on Google &amp; Meta</li>
              <li>Automated budget optimization</li>
              <li>Monthly invoicing based on real spend</li>
              <li>No setup fee, no contract</li>
            </ul>
            <Link to="/get-started" className="btn btn-primary btn-lg">
              Get started free
            </Link>
          </div>
        </Reveal>
      </section>

      <section className="section section-alt">
        <Reveal>
          <div className="section-header">
            <h2>Pricing questions</h2>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="faq">
            {FAQ_ITEMS.map((f) => (
              <div className="faq-item faq-item--static" key={f.q}>
                <div className="faq-question">
                  <span className="faq-question-text">{f.q}</span>
                </div>
                <p className="faq-answer">{f.a}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <BackToTop />

      <SiteFooter />
    </div>
  );
}
