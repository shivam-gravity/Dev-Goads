import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function CrmRedirect() {
  const { loginWithCrmToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("No authentication token provided");
      return;
    }

    loginWithCrmToken(token)
      .then(() => navigate("/dashboard", { replace: true }))
      .catch((err) => setError(err.message || "Authentication failed"));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center p-8 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">Authentication Failed</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">{error}</p>
          <p className="text-sm text-[var(--text-secondary)]">
            Please return to your CRM and try again, or{" "}
            <a href="/login" className="text-[var(--accent-primary)] hover:underline">sign in manually</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-[var(--text-secondary)]">Connecting from CRM...</p>
      </div>
    </div>
  );
}
