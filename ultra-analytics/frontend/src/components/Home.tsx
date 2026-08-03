import { useEffect, useState } from "react";
import type { RedeemResult } from "../api";
import {
  deleteRide,
  getCabinet,
  syncProvider,
} from "../api";
import type {
  Cabinet,
  Provider,
  User,
} from "../types";
import { canImportPlannedRoute } from "../subscription/features";
import { hasSeenOnboarding } from "../onboarding/persistence";
import type { OnboardingDest } from "../onboarding/steps";
import ProGate from "./account/ProGate";
import Onboarding from "./onboarding/Onboarding";
import AppShell, { type ShellSpace } from "./shell/AppShell";
import FocusLock from "./ui/FocusLock";
import RydnLoader from "./ui/RydnLoader";
import { GroupUltraModal } from "./home/GroupUltraModal";
import { LibrarySpace } from "./home/LibrarySpace";
import { PlanningSpace } from "./home/PlanningSpace";
import { TripsSpace } from "./home/TripsSpace";
import { UploadModal } from "./home/UploadModal";
import { YouSpace } from "./home/YouSpace";

interface Props {
  user: User;
  providers: Provider[];
  space?: ShellSpace;
  onSpace?: (s: ShellSpace) => void;
  onOpenRide: (id: string) => void;
  onOpenUltra: (id: string, from?: "planning" | "trips") => void;
  onOpenRoute: (id: string) => void;
  onSignOut: () => void;
  onRefreshProviders: () => Promise<void>;
  onUpdateProfile: (patch: { weightKg?: number | null }) => Promise<User>;
  onRedeemCode: (code: string) => Promise<RedeemResult>;
  onRefreshUser?: () => Promise<void>;
  bootError?: string | null;
  onDismissBootError?: () => void;
}

/** P0 shell: Planning · Trips · Library (Account via avatar). */
export default function Home({
  user,
  providers,
  space: spaceProp,
  onSpace: onSpaceProp,
  onOpenRide,
  onOpenUltra,
  onOpenRoute,
  onSignOut,
  onRefreshProviders,
  onUpdateProfile,
  onRedeemCode,
  onRefreshUser,
  bootError,
  onDismissBootError,
}: Props) {
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showProGate, setShowProGate] = useState(false);
  /** Once per login session; cleared on logout. Redeem RYDN-ONBOARD can reopen. */
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  /** Desktop: centered modal; phone: fullscreen sheet (already polished). */
  const [proGateWide, setProGateWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 721px)").matches,
  );
  const [showGroup, setShowGroup] = useState(false);
  const canImportPlanned = canImportPlannedRoute(user);
  const [groupSeed, setGroupSeed] = useState<{
    activityIds?: string[];
    name?: string;
  } | null>(null);
  const [spaceLocal, setSpaceLocal] = useState<ShellSpace>("planning");
  const space = spaceProp ?? spaceLocal;
  const setSpace = onSpaceProp ?? setSpaceLocal;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 721px)");
    const onChange = () => setProGateWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const connectedProvider = providers.find((p) => p.connected);
  const connectable = providers.find((p) => p.enabled && !p.connected);

  const refresh = async () => {
    try {
      setCabinet(await getCabinet());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runSync = async () => {
    if (!connectedProvider) return;
    setSyncing(true);
    setError(null);
    try {
      const r = await syncProvider(connectedProvider.id);
      setNotice(
        r.added > 0
          ? `Imported ${r.added} source day${r.added === 1 ? "" : "s"} into Library.`
          : "Library is up to date.",
      );
      setSpace("library");
      await Promise.all([refresh(), onRefreshProviders()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stripe return — Race Pass credit may land via webhook slightly after redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    if (billing === "cancel") {
      setNotice("Checkout canceled — no charge.");
    } else if (billing === "race_pass_success") {
      setNotice("Race Pass ready — pick a GPX to unlock that route.");
      setSpace("planning");
      setShowUpload(true);
      void (async () => {
        for (let i = 0; i < 5; i++) {
          await onRefreshUser?.();
          await new Promise((r) => setTimeout(r, 800));
        }
      })();
    } else if (billing === "success") {
      setNotice("Pro is active — Planning unlocked.");
      setSpace("you");
      void onRefreshUser?.();
    }
    params.delete("billing");
    const next = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
  }, [onRefreshUser, setSpace]);

  const onDeleteRide = async (id: string) => {
    const ok = window.confirm(
      "Remove this day from your Library? It will also leave any trip that includes it.",
    );
    if (!ok) return;
    setCabinet((c) =>
      c
        ? {
            ...c,
            ungroupedRides: c.ungroupedRides.filter((x) => x.id !== id),
            completedUltras: c.completedUltras.map((u) => ({
              ...u,
              activityIds: u.activityIds.filter((a) => a !== id),
            })),
          }
        : c,
    );
    try {
      await deleteRide(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      void refresh();
    }
  };

  const loading = cabinet == null;
  const completedUltras = cabinet?.completedUltras ?? [];
  const planningUltras = cabinet?.planningUltras ?? [];
  const plannedRoutes = cabinet?.plannedRoutes ?? [];
  const ungrouped = cabinet?.ungroupedRides ?? [];
  const suggestions = cabinet?.suggestions ?? [];

  const openGroup = (seed?: { activityIds?: string[]; name?: string }) => {
    setGroupSeed(seed ?? null);
    setShowGroup(true);
  };

  return (
    <AppShell user={user} space={space} onSpace={setSpace}>
      {bootError && (
        <div className="banner banner--err" role="alert">
          {bootError}
          <button
            type="button"
            className="banner__dismiss"
            onClick={() => onDismissBootError?.()}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="banner banner--ok" role="status">
          {notice}
          <button type="button" className="banner__dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="banner banner--err" role="alert">
          {error}
          <button type="button" className="banner__dismiss" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {loading && (
        <div className="space-loading space-loading--visual">
          <RydnLoader label="Loading…" />
        </div>
      )}

      {!loading && space === "planning" && (
        <PlanningSpace
          upcoming={planningUltras}
          routes={plannedRoutes}
          canImportPlanned={canImportPlanned}
          onOpenUltra={(id) => onOpenUltra(id, "planning")}
          onOpenRoute={onOpenRoute}
          onImportRoute={() => {
            if (!canImportPlanned) {
              setShowProGate(true);
              return;
            }
            setShowUpload(true);
          }}
        />
      )}

      {!loading && space === "trips" && (
        <TripsSpace
          completed={completedUltras}
          libraryCount={ungrouped.length}
          onOpenUltra={(id) => onOpenUltra(id, "trips")}
          onGoLibrary={() => setSpace("library")}
          onGroup={() => openGroup()}
        />
      )}

      {!loading && space === "library" && (
        <LibrarySpace
          days={ungrouped}
          suggestions={suggestions}
          syncing={syncing}
          connectable={connectable}
          connectedProvider={connectedProvider}
          onSync={runSync}
          onUpload={() => setShowUpload(true)}
          onGroup={() => openGroup()}
          onSuggestGroup={(s) => openGroup({ activityIds: s.activityIds, name: s.label })}
          onOpenRide={onOpenRide}
          onDelete={onDeleteRide}
        />
      )}

      {!loading && space === "you" && (
        <YouSpace
          user={user}
          providers={providers}
          syncing={syncing}
          onSync={runSync}
          onUpload={() => setShowUpload(true)}
          onSignOut={onSignOut}
          onUpdateProfile={onUpdateProfile}
          onRedeemCode={onRedeemCode}
          onRefreshUser={onRefreshUser}
          onShowOnboarding={() => setShowOnboarding(true)}
        />
      )}

      {showProGate && (
        <FocusLock
          open
          onClose={() => setShowProGate(false)}
          labelledBy="pro-gate-title"
          /* Phone sheet stays; desktop uses centered modal card. */
          variant={proGateWide ? "modal" : "sheet"}
          className={proGateWide ? "pro-gate-modal" : "pro-gate-sheet"}
        >
          <h2 id="pro-gate-title" className="visually-hidden">
            Unlock Planning
          </h2>
          <ProGate
            feature="planning"
            intent="import"
            onBack={() => setShowProGate(false)}
            onOpenAccount={() => {
              setShowProGate(false);
              setSpace("you");
            }}
          />
        </FocusLock>
      )}

      <Onboarding
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onFinish={(dest: OnboardingDest) => {
          setShowOnboarding(false);
          setSpace(dest);
        }}
      />

      {showUpload && (
        <UploadModal
          allowPlanning={canImportPlanned}
          onClose={() => setShowUpload(false)}
          onProRequired={() => {
            setShowUpload(false);
            setShowProGate(true);
          }}
          onImportedRide={(id) => {
            setShowUpload(false);
            setNotice("Imported as completed ride — in Library.");
            setSpace("library");
            void refresh().then(() => onOpenRide(id));
          }}
          onImportedRoute={(id) => {
            setShowUpload(false);
            setNotice("Imported as planned route — in Planning.");
            setSpace("planning");
            void Promise.all([refresh(), onRefreshUser?.()]).then(() => onOpenRoute(id));
          }}
        />
      )}

      {showGroup && (
        <GroupUltraModal
          rides={ungrouped}
          seed={groupSeed}
          onClose={() => {
            setShowGroup(false);
            setGroupSeed(null);
          }}
          onCreated={async () => {
            setShowGroup(false);
            setGroupSeed(null);
            setSpace("trips");
            setNotice("Trip saved to your cabinet.");
            await refresh();
          }}
        />
      )}
    </AppShell>
  );
}
