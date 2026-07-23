import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <nav className="flex items-center justify-between px-8 py-4 border-b border-[var(--border-primary)]">
        <div className="text-xl font-bold text-[var(--text-primary)]">CRM Ads</div>
        <div className="flex items-center gap-4">
          <Link to="/features" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Features</Link>
          <Link to="/pricing" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Pricing</Link>
          <Link to="/login" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Sign in</Link>
          <Link to="/register" className="px-4 py-2 text-sm rounded-lg bg-[var(--accent-primary)] text-white font-medium hover:opacity-90">
            Get Started
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-8 py-24 text-center">
        <h1 className="text-5xl font-bold text-[var(--text-primary)] leading-tight">
          AI-Powered Ad Campaigns<br />Built in Minutes
        </h1>
        <p className="mt-6 text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
          Generate research-backed ad strategies, creatives, and campaigns across Meta, Google, and TikTok — powered by deep market intelligence.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link to="/register" className="px-6 py-3 rounded-lg bg-[var(--accent-primary)] text-white font-medium text-lg hover:opacity-90">
            Start Free
          </Link>
          <Link to="/features" className="px-6 py-3 rounded-lg border border-[var(--border-primary)] text-[var(--text-primary)] font-medium text-lg hover:bg-[var(--bg-secondary)]">
            Learn More
          </Link>
        </div>

        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <div className="text-2xl mb-3">🔬</div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-2">Deep Research</h3>
            <p className="text-sm text-[var(--text-secondary)]">9 research providers analyze your market, competitors, and audience in parallel.</p>
          </div>
          <div className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <div className="text-2xl mb-3">🤖</div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-2">10 AI Agents</h3>
            <p className="text-sm text-[var(--text-secondary)]">Specialized agents for targeting, copy, creative, budget, and more — working together.</p>
          </div>
          <div className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
            <div className="text-2xl mb-3">📊</div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-2">Live Optimization</h3>
            <p className="text-sm text-[var(--text-secondary)]">Real-time performance tracking with AI-driven budget and creative recommendations.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
