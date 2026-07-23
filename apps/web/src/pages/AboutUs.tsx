import { Link } from "react-router-dom";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import BackToTop from "../components/BackToTop.js";
import Reveal from "../components/Reveal.js";
import { MascotIcon } from "../components/icons.js";

export default function AboutUs() {
  return (
    <div className="landing">
      <SiteNav />
      <section className="hero hero-compact">
        <MascotIcon className="mascot" />
        <span className="eyebrow">About us</span>
        <h1>Why we built CRM Ads</h1>
        <p className="lead">
          Running ads well means constant, tedious work: researching audiences, writing variants, checking dashboards,
          and moving budget around by hand. CRM Ads exists to automate that loop end to end, from the first strategy
          draft to the ongoing optimization, so the people running the business can spend less time managing tabs and
          more time on the business itself.
        </p>
      </section>

      <section className="section">
        <Reveal>
          <div className="section-header">
            <h2>What we believe</h2>
          </div>
        </Reveal>
        <div className="benefits-grid">
          <Reveal delay={0}>
            <div className="benefit-card">
              <h3>Automation should be inspectable</h3>
              <p>Every automated action — a budget change, a pause — is logged with a reason. Nothing happens silently.</p>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <div className="benefit-card">
              <h3>You approve before it spends</h3>
              <p>Strategy and creatives sit in review until a human signs off — the AI proposes, you decide.</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="cta-banner">
        <Reveal>
          <div className="cta-banner-inner">
            <h2>Get started free</h2>
            <p>See the full flow with your own business description.</p>
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
