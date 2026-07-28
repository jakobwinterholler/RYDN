import { useEffect, useState, useCallback } from "react";
import Home from "./components/Home";
import Review from "./components/Review";
import UltraPage from "./components/UltraPage";
import UltraAnalyticsPage from "./components/UltraAnalyticsPage";
import RoutePage from "./components/RoutePage";
import Welcome from "./components/Welcome";
import ConnectProvider from "./components/ConnectProvider";
import SyncProgress from "./components/SyncProgress";
import RydnLoader from "./components/ui/RydnLoader";
import { getRide } from "./api";
import { useAuth } from "./auth/useAuth";
import type { Report } from "./types";

type HomeSpace = "ultras" | "library" | "you";

type Screen =
  | { kind: "home"; space?: HomeSpace }
  | { kind: "ultra"; ultraId: string }
  | { kind: "ultraAnalytics"; ultraId: string }
  | { kind: "route"; routeId: string }
  | {
      kind: "ride";
      rideId: string;
      backUltraId?: string;
      backTo?: "ultra" | "ultraAnalytics" | "home";
    };

function screenToPath(screen: Screen): string {
  switch (screen.kind) {
    case "home": {
      if (screen.space && screen.space !== "ultras") {
        return `/?space=${screen.space}`;
      }
      return "/";
    }
    case "ultra":
      return `/ultras/${screen.ultraId}`;
    case "ultraAnalytics":
      return `/ultras/${screen.ultraId}/analytics`;
    case "route":
      return `/routes/${screen.routeId}`;
    case "ride": {
      const q = new URLSearchParams();
      if (screen.backUltraId && screen.backTo === "ultraAnalytics") {
        q.set("from", "analytics");
        q.set("ultra", screen.backUltraId);
      } else if (screen.backUltraId && screen.backTo === "ultra") {
        q.set("from", "ultra");
        q.set("ultra", screen.backUltraId);
      }
      const qs = q.toString();
      return qs ? `/rides/${screen.rideId}?${qs}` : `/rides/${screen.rideId}`;
    }
  }
}

function pathToScreen(pathname: string, search = ""): Screen {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  if (parts[0] === "ultras" && parts[1] && parts[2] === "analytics") {
    return { kind: "ultraAnalytics", ultraId: parts[1] };
  }
  if (parts[0] === "ultras" && parts[1]) {
    return { kind: "ultra", ultraId: parts[1] };
  }
  if (parts[0] === "routes" && parts[1]) {
    return { kind: "route", routeId: parts[1] };
  }
  if (parts[0] === "rides" && parts[1]) {
    const from = params.get("from");
    const ultra = params.get("ultra") || undefined;
    if (from === "analytics" && ultra) {
      return { kind: "ride", rideId: parts[1], backUltraId: ultra, backTo: "ultraAnalytics" };
    }
    if (from === "ultra" && ultra) {
      return { kind: "ride", rideId: parts[1], backUltraId: ultra, backTo: "ultra" };
    }
    return { kind: "ride", rideId: parts[1], backTo: "home" };
  }
  const space = params.get("space");
  if (space === "library" || space === "you" || space === "ultras") {
    return { kind: "home", space };
  }
  return { kind: "home", space: "ultras" };
}

function backFromRide(screen: Extract<Screen, { kind: "ride" }>): Screen {
  if (!screen.backUltraId) return { kind: "home", space: "library" };
  if (screen.backTo === "ultraAnalytics") {
    return { kind: "ultraAnalytics", ultraId: screen.backUltraId };
  }
  if (screen.backTo === "ultra") {
    return { kind: "ultra", ultraId: screen.backUltraId };
  }
  return { kind: "home", space: "library" };
}

function rideBackLabel(screen: Extract<Screen, { kind: "ride" }>): string {
  if (screen.backTo === "ultraAnalytics") return "Analytics";
  if (screen.backUltraId) return "Ultra";
  return "Library";
}

const PROVIDER_ERRORS: Record<string, string> = {
  denied: "Connection was cancelled. You can try again anytime from You.",
  state: "Sign-in expired before connecting. Try again.",
  session: "Your session changed during connect. Sign in and try again.",
  unknown: "That provider isn’t available.",
};

export default function App() {
  const auth = useAuth();
  const [screen, setScreenState] = useState<Screen>(() =>
    pathToScreen(window.location.pathname, window.location.search),
  );
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syncPid, setSyncPid] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const navigate = useCallback((next: Screen, opts?: { replace?: boolean }) => {
    setScreenState(next);
    const path = screenToPath(next);
    if (opts?.replace) {
      window.history.replaceState(next, "", path);
    } else {
      window.history.pushState(next, "", path);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const authErr = params.get("auth_error");
    const providerErr = params.get("provider_error");

    // Keep deep-link back/space params; strip one-shot OAuth banners.
    const keep = new URLSearchParams();
    for (const key of ["from", "ultra", "space"]) {
      const v = params.get(key);
      if (v) keep.set(key, v);
    }
    const qs = keep.toString();
    const clean = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    const initial = pathToScreen(window.location.pathname, window.location.search);
    setScreenState(initial);
    window.history.replaceState(initial, "", clean);

    if (connected) setSyncPid(connected);
    if (authErr) setBootError("Google sign-in failed. Please try again.");
    if (providerErr) {
      setBootError(
        PROVIDER_ERRORS[providerErr] ||
          "Could not connect that service. Please try again.",
      );
    }

    const onPop = (e: PopStateEvent) => {
      if (e.state && typeof e.state === "object" && "kind" in e.state) {
        setScreenState(e.state as Screen);
      } else {
        setScreenState(pathToScreen(window.location.pathname, window.location.search));
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const rideId = screen.kind === "ride" ? screen.rideId : null;

  useEffect(() => {
    if (!rideId) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRide(rideId)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  useEffect(() => {
    const titles: Record<Screen["kind"], string> = {
      home: "RYDN",
      ultra: "Ultra · RYDN",
      ultraAnalytics: "Analytics · RYDN",
      route: "Route · RYDN",
      ride: "Day · RYDN",
    };
    document.title = titles[screen.kind] || "RYDN";
  }, [screen.kind]);

  if (auth.loading) {
    return (
      <div className="app-loading">
        <RydnLoader label="Loading RYDN…" />
      </div>
    );
  }

  if (!auth.user) {
    return (
      <Welcome
        config={auth.config}
        onGoogle={auth.signInGoogle}
        onDev={auth.signInDev}
        error={auth.error || bootError}
      />
    );
  }

  if (syncPid) {
    const p = auth.providers.find((x) => x.id === syncPid);
    return (
      <SyncProgress
        providerId={syncPid}
        providerLabel={p?.label ?? "Strava"}
        onDone={async () => {
          await auth.completeOnboarding();
          await auth.refreshProviders();
          setSyncPid(null);
          navigate({ kind: "home", space: "library" }, { replace: true });
        }}
        onSkip={async () => {
          await auth.completeOnboarding();
          await auth.refreshProviders();
          setSyncPid(null);
          navigate({ kind: "home" }, { replace: true });
        }}
      />
    );
  }

  const pending = auth.providers.find((p) => p.enabled && !p.connected);
  if (!auth.user.onboardedAt && pending) {
    return <ConnectProvider provider={pending} onSkip={auth.completeOnboarding} />;
  }

  if (screen.kind === "route") {
    return (
      <div className="page-enter">
        <RoutePage
          routeId={screen.routeId}
          onBack={() => navigate({ kind: "home", space: "ultras" })}
          onDeleted={() => navigate({ kind: "home", space: "ultras" }, { replace: true })}
        />
      </div>
    );
  }

  if (screen.kind === "ultra") {
    return (
      <div className="page-enter">
        <UltraPage
          ultraId={screen.ultraId}
          onBack={() => navigate({ kind: "home", space: "ultras" })}
          onDeleted={() => navigate({ kind: "home", space: "ultras" }, { replace: true })}
          onOpenRide={(id) =>
            navigate({
              kind: "ride",
              rideId: id,
              backUltraId: screen.ultraId,
              backTo: "ultra",
            })
          }
          onOpenAnalytics={() =>
            navigate({ kind: "ultraAnalytics", ultraId: screen.ultraId })
          }
        />
      </div>
    );
  }

  if (screen.kind === "ultraAnalytics") {
    return (
      <div className="page-enter">
        <UltraAnalyticsPage
          ultraId={screen.ultraId}
          onBack={() => navigate({ kind: "ultra", ultraId: screen.ultraId })}
          onOpenRide={(id) =>
            navigate({
              kind: "ride",
              rideId: id,
              backUltraId: screen.ultraId,
              backTo: "ultraAnalytics",
            })
          }
        />
      </div>
    );
  }

  if (screen.kind === "ride") {
    if (loading || (!report && !error)) {
      return (
        <div className="app-loading">
          <RydnLoader label="Opening day…" />
        </div>
      );
    }
    if (error) {
      return (
        <div className="app-loading">
          <p>{error}</p>
          <p className="space__hint">Check your connection, then try again.</p>
          <button type="button" className="btn btn--secondary" onClick={() => navigate(backFromRide(screen))}>
            Back to {rideBackLabel(screen)}
          </button>
        </div>
      );
    }
    return (
      <div className="page-enter">
        <Review
          report={report as Report}
          onBack={() => navigate(backFromRide(screen))}
          backLabel={rideBackLabel(screen)}
        />
      </div>
    );
  }

  return (
    <div className="page-enter">
      <Home
        user={auth.user}
        providers={auth.providers}
        space={screen.space || "ultras"}
        onSpace={(space) => navigate({ kind: "home", space }, { replace: true })}
        onOpenRide={(id) => navigate({ kind: "ride", rideId: id, backTo: "home" })}
        onOpenUltra={(id) => navigate({ kind: "ultra", ultraId: id })}
        onOpenRoute={(id) => navigate({ kind: "route", routeId: id })}
        onSignOut={auth.signOut}
        onRefreshProviders={auth.refreshProviders}
        bootError={bootError}
        onDismissBootError={() => setBootError(null)}
      />
    </div>
  );
}
