import { useState } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import { cloudSyncUnavailableUserMessage } from "@shared/companion/userFacingErrors";
import { GoogleSignInButton } from "@shared/ui/GoogleSignInButton";

function CompanionLogo() {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-teal-500/10 ring-1 ring-white/10">
      <svg className="h-8 w-8 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M4 12c2-4 6-7 8-7s6 3 8 7c-2 4-6 7-8 7s-6-3-8-7z" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2" strokeLinecap="round" opacity="0.5" />
      </svg>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm text-white/55">
      <span className="text-emerald-400">•</span>
      {children}
    </li>
  );
}

export default function WelcomeScreen() {
  const { configured, signInWithGoogle, authError, signingIn } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  async function handleSignIn() {
    setRedirecting(true);
    try {
      await signInWithGoogle();
    } catch {
      setRedirecting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0a0a] px-6 pb-10 pt-safe-top">
      <div className="flex flex-1 flex-col items-center justify-center text-center animate-fade-in">
        <CompanionLogo />
        <h1 className="mt-6 text-[1.75rem] font-semibold tracking-tight text-white">
          Ultra Roadbook Companion
        </h1>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-white/55">
          Take your verified race planning with you.
        </p>

        <div className="mt-10 w-full max-w-sm">
          <GoogleSignInButton
            variant="dark"
            onClick={() => void handleSignIn()}
            disabled={!configured}
            loading={redirecting || signingIn}
          />
        </div>

        {!configured ? (
          <p className="mt-4 max-w-xs text-xs text-red-300">
            {cloudSyncUnavailableUserMessage()}
          </p>
        ) : null}

        {authError ? <p className="mt-4 max-w-sm text-sm text-red-300">{authError}</p> : null}

        <ul className="mt-10 space-y-2.5 text-left">
          <Feature>Works offline</Feature>
          <Feature>Verified stops</Feature>
          <Feature>Resupply</Feature>
          <Feature>Climbs</Feature>
          <Feature>Unsupported sections</Feature>
        </ul>
      </div>
    </div>
  );
}
