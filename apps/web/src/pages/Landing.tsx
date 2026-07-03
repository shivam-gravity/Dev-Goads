import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Reveal from "../components/Reveal.js";
import { MascotIcon, SparkleIcon } from "../components/icons.js";

const CATEGORIES = [
  {
    name: "E-commerce",
    blurb: "Product-led creative and retargeting built around your catalog and average order value.",
    tags: ["Fashion", "Beauty", "Home goods", "Subscription boxes"],
    preview: {
      headline: "20% off your first order",
      body: "Free shipping over $50 — shop the new arrivals before they're gone.",
    },
  },
  {
    name: "Local services",
    blurb: "Radius targeting and call/booking-focused creative for restaurants, salons, gyms, and clinics.",
    tags: ["Restaurants", "Salons", "Gyms", "Clinics"],
    preview: {
      headline: "Book this week, save 15%",
      body: "Locally loved, now taking new clients in your neighborhood.",
    },
  },
  {
    name: "SaaS & services",
    blurb: "Lead-gen audiences and messaging tuned to your goals, from demos booked to trials started.",
    tags: ["B2B software", "Agencies", "Consultants", "Freelancers"],
    preview: {
      headline: "Book a 15-minute demo",
      body: "See how teams save six hours a week on manual busywork.",
    },
  },
  {
    name: "Apps",
    blurb: "Install and engagement campaigns split across networks based on where your users actually are.",
    tags: ["Mobile games", "Fitness apps", "Finance apps", "Social apps"],
    preview: {
      headline: "Download free this week",
      body: "Join the people already using it — no in-app ads, ever.",
    },
  },
];

const TABS = [
  {
    key: "strategy",
    label: "Strategy",
    title: "AI builds the strategy first",
    body: "Claude reads your business description and goals, then proposes recommended networks, a budget split, target audiences, and ad creatives — all before a dollar is spent.",
  },
  {
    key: "launch",
    label: "Launch",
    title: "One click, both networks",
    body: "Approve the strategy and AdGo creates and launches the campaign variants on Google and Meta through their live APIs.",
  },
  {
    key: "optimize",
    label: "Optimize",
    title: "Budget moves toward what wins",
    body: "An epsilon-greedy bandit reviews performance per variant, shifts spend toward the best performer, keeps exploring the rest, and pauses anything with a high cost per acquisition.",
  },
];

const BENEFITS = [
  {
    title: "Zero manual bidding",
    body: "AdGo builds the audiences, budget split, and creatives — you approve, it launches.",
  },
  {
    title: "One dashboard, two networks",
    body: "Google Ads and Meta campaigns launch and report from the same place, no tab-switching.",
  },
  {
    title: "Budget moves on its own",
    body: "A bandit algorithm exploits your best-converting variant, explores the rest, and pauses high-CPA ones automatically.",
  },
  {
    title: "Pay for what it manages",
    body: "A flat monthly fee plus a percentage of spend under management — nothing to configure.",
  },
];

const FAQS = [
  {
    q: "Do I need an Anthropic API key to use this?",
    a: "No. Strategy generation uses Claude when a key is configured, and falls back to a deterministic strategy engine otherwise — the full flow works either way.",
  },
  {
    q: "Which ad networks does AdGo support?",
    a: "Google Ads and Meta today. Adapters make live API calls once credentials are configured, and use mock data otherwise so you can try the full flow first.",
  },
  {
    q: "How does the budget optimization actually work?",
    a: "An epsilon-greedy bandit reviews performance per variant, shifts spend toward the best-converting one, keeps exploring the others, and pauses anything with a high cost per acquisition.",
  },
  {
    q: "How is this billed?",
    a: "A flat base fee plus a percentage of ad spend AdGo manages on your behalf — generated as a monthly invoice from real campaign spend.",
  },
];

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function Landing() {
  const [budget, setBudget] = useState(2000);
  const [cpa, setCpa] = useState(40);
  const [activeTab, setActiveTab] = useState(0);
  const [activeCategory, setActiveCategory] = useState(0);

  const { reclaimed, extraConversions } = useMemo(() => {
    const reclaimedBudget = Math.round(budget * 0.15);
    const conversions = cpa > 0 ? Math.round(reclaimedBudget / cpa) : 0;
    return { reclaimed: reclaimedBudget, extraConversions: conversions };
  }, [budget, cpa]);

  const category = CATEGORIES[activeCategory];

  return (
    <div className="landing">
      <div className="announce-bar">
        <SparkleIcon />
        <span>Live demo — generate a real AI ad strategy in under a minute</span>
        <SparkleIcon />
      </div>

      <header className="landing-nav">
        <Link to="/" className="brand">
          AdGo
        </Link>
        <nav className="landing-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <Link to="/get-started" className="btn btn-primary">
            Get started
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-mascot-row">
          <MascotIcon className="mascot" />
          <span className="status-chip">
            <span className="live-dot" />
            Strategy engine online
          </span>
        </div>
        <span className="eyebrow">AI-driven ad automation</span>
        <h1>
          Describe your business.
          <br />
          Let <span className="highlight">AI run your ads</span>.
        </h1>
        <p className="lead">
          AdGo generates a full ad strategy from a short business description, launches it across Google and Meta,
          and continuously reallocates your budget toward what's actually converting.
        </p>
        <div className="hero-actions">
          <Link to="/get-started" className="btn btn-primary btn-lg">
            Get started free
          </Link>
          <a href="#how-it-works" className="btn btn-secondary btn-lg">
            See how it works
          </a>
        </div>
        <p className="hero-note">No credit card required to try the full flow.</p>

        <div className="sticky-note">No signup wall on the demo</div>

        <div className="float-card float-card-left">
          <div className="float-card-title">Strategy ready</div>
          <div className="float-card-bars">
            <div className="float-bar" style={{ height: "70%" }} />
            <div className="float-bar" style={{ height: "45%" }} />
            <div className="float-bar" style={{ height: "85%" }} />
            <div className="float-bar" style={{ height: "60%" }} />
          </div>
          <div className="float-card-caption">Google 55% · Meta 45%</div>
        </div>

        <div className="float-card float-card-right">
          <div className="float-card-title">
            <span className="live-dot" /> Campaign live
          </div>
          <div className="float-card-stat">
            <span>CTR</span>
            <strong>3.2%</strong>
          </div>
          <div className="float-card-stat">
            <span>CPA</span>
            <strong>$18.40</strong>
          </div>
        </div>
      </section>

      <div className="trust-strip">
        <span className="trust-chip">Runs on Google Ads</span>
        <span className="trust-chip">Runs on Meta Ads</span>
        <span className="trust-chip">Strategy generated by Claude</span>
        <span className="trust-chip">Usage-based billing</span>
      </div>

      <section className="section" id="how-it-works">
        <Reveal>
          <div className="section-header">
            <h2>How it works</h2>
            <p>From a business description to a live, self-optimizing campaign in three steps.</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="tabs">
            <div className="tab-list" style={{ ["--tab-count" as string]: TABS.length }}>
              <div className="tab-indicator" style={{ transform: `translateX(${activeTab * 100}%)` }} />
              {TABS.map((tab, i) => (
                <button
                  key={tab.key}
                  className={`tab-btn ${activeTab === i ? "active" : ""}`}
                  onClick={() => setActiveTab(i)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="tab-panel">
              <div className="step-number">{activeTab + 1}</div>
              <h3>{TABS[activeTab].title}</h3>
              <p>{TABS[activeTab].body}</p>
            </div>
          </div>
        </Reveal>
      </section>

      <section className="section section-alt">
        <Reveal>
          <div className="section-header">
            <h2>Built for how you sell</h2>
            <p>Pick your category — AdGo tailors targeting and creative accordingly.</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="category-split">
            <div className="category-accordion">
              {CATEGORIES.map((c, i) => (
                <div key={c.name} className={`accordion-row ${activeCategory === i ? "open" : ""}`}>
                  <button className="accordion-header" onClick={() => setActiveCategory(i)}>
                    {c.name}
                  </button>
                  {activeCategory === i && (
                    <div className="accordion-body">
                      <p>{c.blurb}</p>
                      <div className="tag-row">
                        {c.tags.map((tag) => (
                          <span className="trust-chip" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="preview-card">
              <div className="preview-card-header">Example creative preview</div>
              <div className="preview-card-image" />
              <div className="preview-card-body">
                <strong>{category.preview.headline}</strong>
                <p>{category.preview.body}</p>
                <span className="btn btn-primary preview-cta">Learn more</span>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <section className="section" id="calculator">
        <Reveal>
          <div className="section-header">
            <h2>See what automated optimization could reclaim</h2>
            <p>A rough estimate of budget AdGo's bandit optimizer could shift away from underperforming variants.</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="calculator">
            <div className="calculator-inputs">
              <label>
                Monthly ad budget (USD)
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={budget}
                  onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
                />
              </label>
              <label>
                Typical cost per conversion (USD)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={cpa}
                  onChange={(e) => setCpa(Math.max(0, Number(e.target.value)))}
                />
              </label>
            </div>
            <div className="calculator-result">
              <span className="big-number">{currency(reclaimed)}/mo</span>
              <span className="result-label">reclaimed from underperforming variants</span>
              <div className="result-secondary">
                <span className="big-number">~{extraConversions}</span>
                <span className="result-label">additional conversions/mo at your current CPA</span>
              </div>
              <p className="calculator-disclaimer">
                Illustrative estimate based on typical bandit-optimization reallocation — actual results depend on
                your campaigns.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      <section className="section section-alt">
        <Reveal>
          <div className="section-header">
            <h2>Why teams use AdGo</h2>
          </div>
        </Reveal>
        <div className="benefits-grid">
          {BENEFITS.map((b, i) => (
            <Reveal delay={i * 60} key={b.title}>
              <div className="benefit-card">
                <h3>{b.title}</h3>
                <p>{b.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section" id="pricing">
        <Reveal>
          <div className="section-header">
            <h2>Simple, usage-based pricing</h2>
            <p>One plan. No contracts.</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="pricing-card">
            <div className="pill">Platform fee</div>
            <div className="price">
              $49<span>/mo + 12% of managed ad spend</span>
            </div>
            <ul>
              <li>AI-generated strategy and creatives</li>
              <li>Launch and manage campaigns on Google &amp; Meta</li>
              <li>Automated budget optimization</li>
              <li>Monthly invoicing based on real spend</li>
            </ul>
            <Link to="/get-started" className="btn btn-primary btn-lg">
              Get started free
            </Link>
          </div>
        </Reveal>
      </section>

      <section className="section section-alt" id="faq">
        <Reveal>
          <div className="section-header">
            <h2>Frequently asked questions</h2>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="faq">
            {FAQS.map((f) => (
              <details className="faq-item" key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </section>

      <section className="cta-banner">
        <Reveal>
          <div className="cta-banner-inner">
            <h2>Ready to put your ad spend on autopilot?</h2>
            <p>Set up your business and get a full ad strategy in minutes.</p>
            <Link to="/get-started" className="btn btn-primary btn-lg">
              Get started free
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="landing-footer">
        <span>AdGo — AI Ad Automation</span>
        <span>© {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
