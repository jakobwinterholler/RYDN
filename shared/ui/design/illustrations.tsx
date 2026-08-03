interface IllustrationProps {
  className?: string;
}

export function NoRacesIllustration({ className = "h-32 w-32" }: IllustrationProps) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden fill="none">
      <rect x="20" y="36" width="88" height="56" rx="12" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <path d="M32 52h64M32 64h40M32 76h52" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
      <circle cx="64" cy="24" r="10" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      <path d="M64 34v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

export function NoInternetIllustration({ className = "h-32 w-32" }: IllustrationProps) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden fill="none">
      <path d="M24 72c16-16 64-16 80 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <path d="M36 84c10-10 46-10 56 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
      <path d="M48 96c6-6 26-6 32 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <circle cx="64" cy="104" r="4" fill="currentColor" opacity="0.7" />
      <path d="M88 40l16 16M104 40L88 56" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

export function NoDownloadsIllustration({ className = "h-32 w-32" }: IllustrationProps) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden fill="none">
      <rect x="40" y="28" width="48" height="72" rx="8" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <path d="M64 48v28M56 68l8 8 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      <path d="M48 108h32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
    </svg>
  );
}

export function VerificationCompleteIllustration({ className = "h-32 w-32" }: IllustrationProps) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden fill="none">
      <circle cx="64" cy="64" r="36" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <path d="M48 64l12 12 24-24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
    </svg>
  );
}

export function ImportGpxIllustration({ className = "h-32 w-32" }: IllustrationProps) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden fill="none">
      <path
        d="M32 88c12-28 52-28 64 0"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.45"
      />
      <path d="M44 72l20-32 20 32" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" opacity="0.35" />
      <rect x="54" y="20" width="20" height="20" rx="6" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      <path d="M64 40v16M58 48h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}
