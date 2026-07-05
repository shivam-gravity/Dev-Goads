import { Link } from "react-router-dom";
import SiteNav from "../components/SiteNav.js";
import SiteFooter from "../components/SiteFooter.js";
import BackToTop from "../components/BackToTop.js";
import Reveal from "../components/Reveal.js";

const POSTS = [
  {
    title: "Why we used an epsilon-greedy bandit instead of a fixed rule",
    excerpt:
      "A fixed rule like \"pause anything below X% CTR\" reacts to noise. A bandit that mostly exploits the best performer but keeps a small exploration budget adapts faster without overreacting to a single bad day.",
    author: "AdGo team",
  },
  {
    title: "What the strategy engine actually sends to the model",
    excerpt:
      "The strategy prompt includes your business description, industry, budget, and goals, and asks for a structured response: recommended networks, a budget split, audiences, and creatives — no freeform text to parse.",
    author: "AdGo team",
  },
  {
    title: "Why every automated action gets logged with a reason",
    excerpt:
      "Budget changes and pauses happen without asking first, but they're never silent — each one is written to an audit log with the reasoning behind it, so you can see why the system did what it did.",
    author: "AdGo team",
  },
];

export default function Blog() {
  return (
    <div className="landing">
      <SiteNav />
      <section className="hero hero-compact">
        <span className="eyebrow">Blog</span>
        <h1>Notes on building AdGo</h1>
        <p className="lead">Short write-ups on the actual design decisions behind the product.</p>
      </section>

      <section className="section">
        <div className="blog-list">
          {POSTS.map((p) => (
            <Reveal key={p.title}>
              <article className="blog-post-card">
                <h3>{p.title}</h3>
                <p>{p.excerpt}</p>
                <span className="blog-author">{p.author}</span>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="cta-banner">
        <Reveal>
          <div className="cta-banner-inner">
            <h2>Read the write-ups, then try the product</h2>
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
