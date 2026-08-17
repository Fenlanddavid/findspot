export function SignalMarkerIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 2.25c-2.42 0-4.4 1.9-4.4 4.25 0 3.15 3.35 6.35 4.05 6.98.2.18.5.18.7 0 .7-.63 4.05-3.83 4.05-6.98 0-2.35-1.98-4.25-4.4-4.25Z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="6.6" r="1.35" fill="currentColor" />
      <path d="M5.1 14.5c1.22.78 2.9 1.25 4.9 1.25s3.68-.47 4.9-1.25M7.65 12.85c.68.26 1.48.4 2.35.4s1.67-.14 2.35-.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
