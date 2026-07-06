import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import { MascotIcon } from "../components/icons.js";

export default function Signup() {
  const { signup, isLoading } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const pwStrength = password.length === 0 ? 0 : password.length < 8 ? 1 : password.length < 12 ? 2 : 3;
  const pwLabels = ["", "Too short", "Good", "Strong"];
  const pwColors = ["", "var(--danger)", "var(--accent)", "var(--accent-2)"];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agreed) { setError("Please agree to the Terms of Service"); return; }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) { setError("Enter your full name."); return; }
    if (!trimmedEmail) { setError("Enter your work email."); return; }
    if (password.trim().length < 8) { setError("Password must be at least 8 characters (not just spaces)."); return; }

    setError(null);
    try {
      await signup(trimmedName, trimmedEmail, password);
      navigate("/get-started");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-bg-grid" />
      <div className="auth-card auth-card-wide">
        <div className="auth-brand">
          <MascotIcon className="mascot hover-wiggle" />
          <span className="auth-brand-name">AdGo</span>
        </div>
        <h1 className="auth-heading">Create your account</h1>
        <p className="auth-subheading">Start your 14-day free trial. No credit card required.</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label">
            Full name
            <input
              id="signup-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
              required
              className="auth-input"
            />
          </label>
          <label className="auth-label">
            Work email
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              required
              autoComplete="email"
              className="auth-input"
            />
          </label>
          <label className="auth-label">
            Password
            <div className="auth-input-wrap">
              <input
                id="signup-password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                minLength={8}
                className="auth-input"
              />
              <button type="button" className="auth-pw-toggle" onClick={() => setShowPw(!showPw)} tabIndex={-1}>
                {showPw ? "🙈" : "👁"}
              </button>
            </div>
            {password.length > 0 && (
              <div className="pw-strength">
                <div className="pw-strength-bar" style={{ width: `${(pwStrength / 3) * 100}%`, background: pwColors[pwStrength] }} />
                <span style={{ color: pwColors[pwStrength], fontSize: 11 }}>{pwLabels[pwStrength]}</span>
              </div>
            )}
          </label>
          <label className="auth-checkbox-label">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} id="agree-tos" />
            <span>I agree to the <Link to="/terms" className="auth-link" target="_blank">Terms of Service</Link> and <Link to="/privacy" className="auth-link" target="_blank">Privacy Policy</Link></span>
          </label>
          <button className="btn btn-primary btn-full" type="submit" disabled={isLoading || !agreed}>
            {isLoading ? "Creating account…" : "Create account →"}
          </button>
        </form>

        <div className="auth-features">
          {["14-day free trial", "No credit card needed", "Cancel anytime"].map((f) => (
            <span key={f} className="auth-feature-badge">✓ {f}</span>
          ))}
        </div>

        <p className="auth-footer-text">
          Already have an account?{" "}
          <Link to="/login" className="auth-link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
