import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Reveal from "../components/Reveal.js";
import CountUp from "../components/CountUp.js";
import BackToTop from "../components/BackToTop.js";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import { GoogleIcon, MascotIcon, SparkleIcon } from "../components/icons.js";

const INDUSTRY_MARQUEE = [
  "E-commerce",
  "Local services",
  "SaaS",
  "Mobile apps",
  "Fitness",
  "Real estate",
  "Fashion",
  "B2B agencies",
  "Restaurants",
  "Home services",
];

const CALCULATOR_INDUSTRIES = [
  { key: "ecommerce", label: "Online shopping", baseUplift: 18, cpm: 12 },
  { key: "services", label: "Services / SaaS", baseUplift: 24, cpm: 18 },
  { key: "local", label: "Local store", baseUplift: 14, cpm: 9 },
  { key: "app", label: "Mobile app", baseUplift: 27, cpm: 7 },
];

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

const TESTIMONIALS = [
  {
    quote:
      "We used to juggle two ad dashboards and a spreadsheet to keep budgets in sync. Now it just moves toward whatever's converting on its own.",
    name: "J. Alvarez",
    role: "Growth lead, e-commerce",
  },
  {
    quote:
      "The first strategy draft needed maybe two tweaks before we launched it. I expected to rewrite the whole thing.",
    name: "P. Nakamura",
    role: "Founder, local services",
  },
  {
    quote:
      "Watching cost-per-acquisition drop after the first optimization pass is what got the rest of the team on board.",
    name: "S. Okafor",
    role: "Marketing manager, SaaS",
  },
];

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function Landing() {
  const [calcIndustry, setCalcIndustry] = useState(0);
  const [calcBudget, setCalcBudget] = useState(2000);
  const [activeTab, setActiveTab] = useState(0);
  const [tabProgress, setTabProgress] = useState(0);
  const [tabAutoPaused, setTabAutoPaused] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [testimonialPaused, setTestimonialPaused] = useState(false);
  const [openFaqs, setOpenFaqs] = useState<number[]>([0]);

  function toggleFaq(i: number) {
    setOpenFaqs((open) => (open.includes(i) ? open.filter((x) => x !== i) : [...open, i]));
  }

  const industry = CALCULATOR_INDUSTRIES[calcIndustry];

  const { uplift, dailyImpressions } = useMemo(() => {
    const budgetBonus = Math.min((calcBudget / 10000) * 6, 6);
    return {
      uplift: Math.round(industry.baseUplift + budgetBonus),
      dailyImpressions: Math.round(((calcBudget / 30) / industry.cpm) * 1000),
    };
  }, [industry, calcBudget]);

  const category = CATEGORIES[activeCategory];

  useEffect(() => {
    if (testimonialPaused) return;
    const id = setInterval(() => {
      setActiveTestimonial((i) => (i + 1) % TESTIMONIALS.length);
    }, 5000);
    return () => clearInterval(id);
  }, [testimonialPaused]);

  useEffect(() => {
    if (tabAutoPaused) return;
    const stepMs = 60;
    const durationMs = 6000;
    const id = setInterval(() => {
      setTabProgress((p) => {
        if (p + (100 * stepMs) / durationMs >= 100) {
          setActiveTab((t) => (t + 1) % TABS.length);
          return 0;
        }
        return p + (100 * stepMs) / durationMs;
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [tabAutoPaused]);

  function selectTab(i: number) {
    setActiveTab(i);
    setTabProgress(0);
    setTabAutoPaused(true);
  }

  return (
    <div className="landing">
      <div className="announce-bar">
        <SparkleIcon className="sparkle-icon" />
        <span>Live demo — generate a real AI ad strategy in under a minute</span>
        <SparkleIcon className="sparkle-icon sparkle-icon-delay" />
      </div>

      <SiteNav />

      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-mascot-row hero-enter" style={{ animationDelay: "0ms" }}>
          <MascotIcon className="mascot" />
          <span className="status-chip">
            <span className="live-dot" />
            Strategy engine online
          </span>
        </div>
        <span className="eyebrow hero-enter" style={{ animationDelay: "80ms" }}>
          AI-driven ad automation
        </span>
        <h1 className="hero-enter" style={{ animationDelay: "160ms" }}>
          Describe your business.
          <br />
          Let <span className="highlight">AI run your ads</span>.
        </h1>
        <p className="lead hero-enter" style={{ animationDelay: "260ms" }}>
          AdGo generates a full ad strategy from a short business description, launches it across Google and Meta,
          and continuously reallocates your budget toward what's actually converting.
        </p>
        <p className="hero-meta hero-enter" style={{ animationDelay: "340ms" }}>
          Setup in under 5 minutes <span className="hero-meta-divider">|</span> Works with your existing Google &amp; Meta ad accounts
        </p>
        <div className="hero-actions hero-enter" style={{ animationDelay: "420ms" }}>
          <Link to="/get-started" className="btn btn-primary btn-lg">
            Get started free
          </Link>
          <Link to="/get-started" className="btn btn-google btn-lg">
            <GoogleIcon />
            Continue with Google
          </Link>
        </div>
        <p className="hero-note hero-enter" style={{ animationDelay: "500ms" }}>
          No credit card required to try the full flow.
        </p>

        <div className="sticky-note">No signup wall on the demo</div>

        <div className="float-card float-card-left">
          <div className="float-card-title">Example strategy output</div>
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
            <span className="live-dot" /> Example campaign
          </div>
          <div className="float-card-stat">
            <span>CTR</span>
            <strong>
              <CountUp to={3.2} decimals={1} suffix="%" />
            </strong>
          </div>
          <div className="float-card-stat">
            <span>CPA</span>
            <strong>
              <CountUp to={18.4} decimals={2} prefix="$" />
            </strong>
          </div>
        </div>
      </section>

      <div className="trust-strip">
        <span className="trust-chip">Runs on Google Ads</span>
        <span className="trust-chip">Runs on Meta Ads</span>
        <span className="trust-chip">Strategy generated by Claude</span>
        <span className="trust-chip">Usage-based billing</span>
      </div>

      <div className="marquee-wrap" aria-hidden="true">
        <div className="marquee-track">
          {[...INDUSTRY_MARQUEE, ...INDUSTRY_MARQUEE].map((item, i) => (
            <span className="marquee-item" key={i}>
              {item}
            </span>
          ))}
        </div>
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
                  onClick={() => selectTab(i)}
                >
                  {tab.label}
                  {activeTab === i && (
                    <span className="tab-progress-track">
                      <span className="tab-progress-fill" style={{ width: `${tabProgress}%` }} />
                    </span>
                  )}
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
                  <div className="accordion-collapse">
                    <div className="accordion-collapse-inner">
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
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="preview-card">
              <div className="preview-card-header">Example creative preview</div>
              <div className="preview-card-image" />
              <div className="preview-card-body">
                <strong>{category.preview.headline}</strong>
                <p>{category.preview.body}</p>
                <Link to="/features" className="btn btn-primary preview-cta">
                  Learn more
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <section className="section" id="calculator">
        <Reveal>
          <div className="section-header">
            <h2>See what automated optimization could reclaim</h2>
            <p>Pick your industry and budget — see the kind of ROAS lift AdGo's optimization loop is built to chase.</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="calculator">
            <div className="calculator-inputs">
              <span className="calculator-step-label">1. Your industry</span>
              <div className="industry-cards">
                {CALCULATOR_INDUSTRIES.map((ind, i) => (
                  <button
                    key={ind.key}
                    className={`industry-card ${calcIndustry === i ? "active" : ""}`}
                    onClick={() => setCalcIndustry(i)}
                  >
                    {ind.label}
                  </button>
                ))}
              </div>

              <span className="calculator-step-label">2. Monthly ad budget</span>
              <input
                type="range"
                min={200}
                max={10000}
                step={50}
                value={calcBudget}
                onChange={(e) => setCalcBudget(Number(e.target.value))}
                className="calculator-slider"
              />
              <div className="calculator-slider-value">
                <strong>{currency(calcBudget)}/mo</strong>
                <span>Estimated impressions: ~{dailyImpressions.toLocaleString()}/day</span>
              </div>
            </div>
            <div className="calculator-result">
              <span className="big-number">
                <CountUp key={`${calcIndustry}-${calcBudget}`} to={uplift} suffix="%" duration={700} />
              </span>
              <span className="result-label">potential ROAS boost in 2 weeks of optimization</span>
              <p className="calculator-disclaimer">*Illustrative estimate based on typical bandit-optimization reallocation — actual results depend on your campaigns.</p>
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

      <section className="section">
        <Reveal>
          <div className="section-header">
            <h2>What early users say</h2>
            <p>Sample feedback from the beta — illustrative, not verified reviews.</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div
            className="testimonial-carousel"
            onMouseEnter={() => setTestimonialPaused(true)}
            onMouseLeave={() => setTestimonialPaused(false)}
          >
            <div className="testimonial-track" style={{ transform: `translateX(-${activeTestimonial * 100}%)` }}>
              {TESTIMONIALS.map((t) => (
                <blockquote className="testimonial-slide" key={t.name}>
                  <p>&ldquo;{t.quote}&rdquo;</p>
                  <footer>
                    <strong>{t.name}</strong>
                    <span>{t.role}</span>
                  </footer>
                </blockquote>
              ))}
            </div>
            <div className="testimonial-dots">
              {TESTIMONIALS.map((t, i) => (
                <button
                  key={t.name}
                  className={`testimonial-dot ${activeTestimonial === i ? "active" : ""}`}
                  aria-label={`Show testimonial ${i + 1}`}
                  onClick={() => setActiveTestimonial(i)}
                />
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      <section className="section" id="pricing">
        <Reveal>
          <div className="section-header">
            <h2>Simple, usage-based pricing</h2>
            <p>One plan. No contracts.</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
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
            <MascotIcon className="mascot-sm faq-mascot" />
            <h2>Frequently asked questions</h2>
            <p>
              Need more details?{" "}
              <a href="mailto:hello@example.com" className="faq-contact-link">
                Contact us
              </a>
              .
            </p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="faq">
            {FAQS.map((f, i) => {
              const open = openFaqs.includes(i);
              return (
                <div className={`faq-item ${open ? "open" : ""}`} key={f.q}>
                  <button className="faq-question" onClick={() => toggleFaq(i)} aria-expanded={open}>
                    <span className="faq-number">{String(i + 1).padStart(2, "0")}</span>
                    <span className="faq-question-text">{f.q}</span>
                    <span className="faq-chevron">⌄</span>
                  </button>
                  <div className="accordion-collapse">
                    <div className="accordion-collapse-inner">
                      <p className="faq-answer">{f.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </section>

      <section className="cta-banner">
        <Reveal>
          <div className="cta-banner-inner">
            <h2>Ready to put your ad spend on autopilot?</h2>
            <p>Set up your business and get a full ad strategy in minutes.</p>
            <div className="hero-actions">
              <Link to="/get-started" className="btn btn-primary btn-lg">
                Get started free
              </Link>
              <a href="mailto:hello@example.com" className="btn btn-secondary btn-lg">
                Book a demo
              </a>
            </div>
            <p className="hero-note cta-banner-note">No credit card required</p>
            <div className="integration-row">
              <span className="integration-chip">Google Ads</span>
              <span className="integration-chip">Meta Ads</span>
            </div>
          </div>
        </Reveal>
      </section>

      <BackToTop />

      <SiteFooter />
    </div>
  );
}

