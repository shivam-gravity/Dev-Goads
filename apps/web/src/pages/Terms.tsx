import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="legal-page">
      <Link to="/" className="brand">
        AdGo
      </Link>
      <h1>Terms of Service</h1>
      <p className="legal-updated">
        Draft — last updated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
        This is a template for review before publishing; it is not a substitute for legal advice.
      </p>

      <section>
        <h2>1. The service</h2>
        <p>
          AdGo generates advertising strategy and creative recommendations, and, with your authorization, creates and
          manages campaigns on Google Ads and Meta on your behalf, including budget reallocation between ad
          variants.
        </p>
      </section>

      <section>
        <h2>2. Your responsibilities</h2>
        <ul>
          <li>You must have authority to connect and manage the Google Ads and Meta ad accounts you link.</li>
          <li>You are responsible for reviewing AI-generated strategy and creatives before approving a campaign for launch.</li>
          <li>You remain responsible for compliance with Google Ads and Meta advertising policies for content you approve.</li>
        </ul>
      </section>

      <section>
        <h2>3. Fees</h2>
        <p>
          The platform fee consists of a flat monthly base fee plus a percentage of ad spend AdGo manages on your
          behalf, invoiced monthly based on actual spend recorded from connected ad accounts.
        </p>
      </section>

      <section>
        <h2>4. Automated actions</h2>
        <p>
          By connecting an ad account, you authorize AdGo's optimization engine to pause underperforming ad variants
          and reallocate budget between variants without prior approval for each individual action. Every automated
          action is logged with a reason and visible in your dashboard.
        </p>
      </section>

      <section>
        <h2>5. Termination</h2>
        <p>
          You may disconnect your ad accounts and stop using AdGo at any time. We may suspend accounts that violate
          these terms or the policies of Google Ads or Meta.
        </p>
      </section>

      <section>
        <h2>6. Disclaimer</h2>
        <p>
          AdGo provides ad strategy and automation tools but does not guarantee any specific advertising results.
          Performance depends on your market, budget, and creative approval decisions.
        </p>
      </section>

      <section>
        <h2>7. Contact</h2>
        <p>legal@example.com — replace with a real contact address before publishing.</p>
      </section>
    </div>
  );
}
