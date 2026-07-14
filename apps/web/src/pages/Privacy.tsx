import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="legal-page">
      <Link to="/" className="brand">
        Polluxa
      </Link>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">
        Draft — last updated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
        This is a template for review before publishing; it is not a substitute for legal advice.
      </p>

      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li>Account and business information you provide during onboarding (business name, website, industry, budget, goals).</li>
          <li>OAuth access tokens for connected Google Ads and Meta ad accounts, stored encrypted at rest.</li>
          <li>Campaign, ad creative, and performance data (impressions, clicks, conversions, spend) retrieved from connected ad accounts.</li>
          <li>Usage data needed to calculate billing (ad spend managed, platform fees).</li>
        </ul>
      </section>

      <section>
        <h2>2. How we use it</h2>
        <ul>
          <li>To generate ad strategy and creative recommendations.</li>
          <li>To create, launch, and manage campaigns on Google Ads and Meta on your behalf, under your explicit authorization.</li>
          <li>To reallocate budget and pause underperforming variants as part of the optimization engine.</li>
          <li>To calculate and invoice usage-based platform fees.</li>
        </ul>
      </section>

      <section>
        <h2>3. Who we share it with</h2>
        <p>
          We send campaign and creative data to Google Ads and Meta Marketing APIs to carry out the actions you
          authorize. Business descriptions are sent to Anthropic's Claude API to generate ad strategy text. Billing
          data is processed by our payment provider. We do not sell your data.
        </p>
      </section>

      <section>
        <h2>4. Retention and deletion</h2>
        <p>
          Account and campaign data is retained for as long as your account is active, plus a limited period for
          billing and audit records. You can request deletion of your account and associated data at any time by
          contacting us; revoking OAuth access in your Google or Meta account settings immediately stops our access
          to that ad account.
        </p>
      </section>

      <section>
        <h2>5. Your rights</h2>
        <p>
          Depending on your location, you may have rights to access, correct, export, or delete your personal data
          (including under GDPR and CCPA). Contact us to exercise these rights.
        </p>
      </section>

      <section>
        <h2>6. Contact</h2>
        <p>privacy@example.com — replace with a real contact address before publishing.</p>
      </section>
    </div>
  );
}
