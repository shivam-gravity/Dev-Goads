import { Link } from "react-router-dom";

/**
 * Shown for any URL that doesn't match a real route — previously this silently redirected
 * to /dashboard with zero feedback, making a mistyped/stale link indistinguishable from a
 * normal visit. A real 404 state at least tells the person the URL they followed was wrong.
 */
export default function NotFound() {
  return (
    <section className="card" style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Page not found</h1>
      <p className="muted-text mt-1">The page you're looking for doesn't exist, or the link may be out of date.</p>
      <Link to="/dashboard" className="btn btn-primary mt-4" style={{ display: "inline-block" }}>
        Back to dashboard
      </Link>
    </section>
  );
}
