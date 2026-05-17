import React from "react";

type LogoMarkProps = {
  className?: string;
  style?: React.CSSProperties;
  gradientId?: string;
  title?: string;
};

export function FindSpotLogoMark({ className, style, gradientId = "findspot-logo-grad", title = "FindSpot" }: LogoMarkProps) {
  return (
    <svg className={className} style={style} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label={title} role="img">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="50%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>

      <circle cx="256" cy="256" r="200" stroke={`url(#${gradientId})`} strokeWidth="32" fill="none" />
      <circle cx="256" cy="256" r="120" stroke={`url(#${gradientId})`} strokeWidth="24" fill="none" opacity="0.6" />
      <circle cx="256" cy="256" r="50" fill={`url(#${gradientId})`} />

      <rect x="244" y="20" width="24" height="80" rx="4" fill={`url(#${gradientId})`} opacity="0.4" />
      <rect x="244" y="412" width="24" height="80" rx="4" fill={`url(#${gradientId})`} opacity="0.4" />
      <rect x="20" y="244" width="80" height="24" rx="4" fill={`url(#${gradientId})`} opacity="0.4" />
      <rect x="412" y="244" width="80" height="24" rx="4" fill={`url(#${gradientId})`} opacity="0.4" />
    </svg>
  );
}

export function Logo() {
  return (
    <FindSpotLogoMark className="h-9 w-9 shrink-0 min-[360px]:h-11 min-[360px]:w-11 sm:h-16 sm:w-16" />
  );
}
