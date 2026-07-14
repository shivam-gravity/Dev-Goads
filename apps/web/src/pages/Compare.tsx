import { Link } from "react-router-dom";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import BackToTop from "../components/BackToTop.js";
import Reveal from "../components/Reveal.js";

const ROWS = [
  { label: "Strategy & audience research", manual: "Hours of manual research per campaign", agency: "Billed hourly, turnaround in days", polluxa: "Generated in under a minute" },
  { label: "Creative variants", manual: "Written one at a time", agency: "Limited by retainer scope", polluxa: "Multiple variants per launch, regenerated from performance data" },
  { label: "Budget reallocation", manual: "Manual, usually weekly at best", agency: "Manual, on the agency's schedule", polluxa: "Continuous, automated bandit optimization" },
  { label: "Multi-network management", manual: "Separate logins and dashboards", agency: "Depends on the agency's tooling", polluxa: "One dashboard for Google Ads and Meta" },
  { label: "Pricing", manual: "Your time", agency: "Retainer + ad spend", polluxa: "Flat fee + % of managed spend, no contract" },
];

export default function Compare() {
  return (
    <div className="landing">
      <SiteNav />
      <section className="hero hero-compact">
        <span className="eyebrow">Compare</span>
        <h1>Polluxa vs. doing it yourself vs. hiring an agency</h1>
        <p className="lead">
          A general comparison of approaches to running paid ads — not a comparison against any specific competing
          product.
        </p>
      </section>

      <section className="section">
        <Reveal>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Manual (you)</th>
                  <th>Agency</th>
                  <th>Polluxa</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label}>
                    <td className="compare-row-label">{r.label}</td>
                    <td>{r.manual}</td>
                    <td>{r.agency}</td>
                    <td className="compare-polluxa-cell">{r.polluxa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>

      <section className="cta-banner">
        <Reveal>
          <div className="cta-banner-inner">
            <h2>Try the Polluxa column yourself</h2>
            <p>Free to run the full flow — no credit card required.</p>
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
