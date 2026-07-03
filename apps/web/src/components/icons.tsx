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
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LiveDotIcon({ className = "" }: { className?: string }) {
  return <span className={`live-dot ${className}`} aria-hidden="true" />;
}
