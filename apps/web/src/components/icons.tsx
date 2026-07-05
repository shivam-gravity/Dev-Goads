export function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 0L8.3 5.7L14 7L8.3 8.3L7 14L5.7 8.3L0 7L5.7 5.7L7 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MascotIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="48" height="48" rx="24" fill="url(#mascot-grad)" />
      <rect x="17" y="21" width="7" height="9" rx="3.5" fill="#fff" />
      <rect x="32" y="21" width="7" height="9" rx="3.5" fill="#fff" />
      <path d="M20 36c2.5 2 5.3 3 8 3s5.5-1 8-3" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M28 4V0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="28" cy="2" r="2" fill="currentColor" />
      <defs>
        <linearGradient id="mascot-grad" x1="4" y1="4" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-mid)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LiveDotIcon({ className = "" }: { className?: string }) {
  return <span className={`live-dot ${className}`} aria-hidden="true" />;
}

export function GoogleIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
    </svg>
  );
}
