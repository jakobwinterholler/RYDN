import { useEffect, useRef, useState } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import {
  getAuthProviderLabel,
  getAvatarUrl,
  getConnectedSince,
  getDisplayName,
} from "@shared/auth/profile";
import { Avatar } from "@shared/ui/AuthScreens";
import { SyncStatusBadge, type SyncIndicator } from "@shared/ui/SyncStatusBadge";
import { readDevicesFromMetadata, updateDeviceLastActive } from "@shared/sync/deviceProfile";
import {
  companionConnectionLabel,
  desktopConnectionLabel,
} from "@shared/ui/accountDevices";
import { formatStorage } from "@shared/ui/formatStorage";
import { estimateCompanionStorageBytes, clearCompanionData, resetLocalRaceCache } from "../db";
import { useCompanionSync } from "../sync/useCompanionSync";
import { useCloudRaceList } from "../sync/useCloudRaceList";
import { usePwaUpdate } from "../pwa/PwaUpdateProvider";

function formatBytes(bytes: number | null): string {
  return formatStorage(bytes);
}

function resolveSyncStatus(syncing: boolean, syncError: string | null): SyncIndicator {
  if (syncing) {
    return "syncing";
  }
  if (syncError) {
    return "waiting-to-sync";
  }
  return "cloud-synced";
}

function DeleteAccountDialog({
  open,
  step,
  busy,
  onClose,
  onContinue,
  onConfirm,
}: {
  open: boolean;
  step: 1 | 2;
  busy: boolean;
  onClose: () => void;
  onContinue: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) {
      setTyped("");
    }
  }, [open, step]);

  if (!open) {
    return null;
  }

  const canConfirm = typed.trim().toUpperCase() === "DELETE" && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md animate-fade-in rounded-2xl border border-white/10 bg-[#111] p-6">
        {step === 1 ? (
          <>
            <h3 className="text-lg font-semibold text-white">Delete account?</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              This signs you out and removes all downloaded races from this phone. Your cloud
              account and races remain until you contact support to permanently delete them.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="min-h-[44px] rounded-xl border border-white/12 px-4 py-2 text-sm text-white/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onContinue}
                disabled={busy}
                className="min-h-[44px] rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-white">Confirm deletion</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              Type <span className="font-mono font-semibold text-white">DELETE</span> to confirm
              removing your account from this device.
            </p>
            <input
              type="text"
              value={typed}
              autoComplete="off"
              autoCapitalize="characters"
              onChange={(event) => setTyped(event.target.value)}
              placeholder="DELETE"
              className="mt-4 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-red-400/50"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="min-h-[44px] rounded-xl border border-white/12 px-4 py-2 text-sm text-white/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!canConfirm}
                className="min-h-[44px] rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Removing…" : "Delete account"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AccountScreen() {
  const { user, signOut } = useAuth();
  const {
    checking,
    lastSyncLabel,
    lastCheckLabel,
    downloadedCount,
    cloudRaceCount,
    maxCloudRevision,
    maxDownloadedRevision,
    updatesAvailable,
    syncError,
    checkMessage,
    updateResults,
    checkProgress,
    checkForUpdates,
  } = useCompanionSync();
  const { races: cloudRaces } = useCloudRaceList();
  const {
    versionLabel,
    pendingVersionLabel,
    updateAvailable,
    applyUpdate,
    applying: applyingUpdate,
  } = usePwaUpdate();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [resettingCache, setResettingCache] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [devToolsVisible, setDevToolsVisible] = useState(false);
  const devTapCountRef = useRef(0);
  const deviceRecorded = useRef(false);

  function revealDevTools() {
    devTapCountRef.current += 1;
    if (devTapCountRef.current >= 7) {
      setDevToolsVisible(true);
    }
  }

  const displayName = getDisplayName(user);
  const avatarUrl = getAvatarUrl(user);
  const connectedSince = getConnectedSince(user);
  const authProvider = getAuthProviderLabel(user);
  const devices = readDevicesFromMetadata(user?.user_metadata);
  const companionConnected = companionConnectionLabel(devices);
  const desktopConnected = desktopConnectionLabel(devices);
  const syncStatus = resolveSyncStatus(checking, syncError);

  useEffect(() => {
    if (!user || deviceRecorded.current) {
      return;
    }
    deviceRecorded.current = true;
    void updateDeviceLastActive("companion");
  }, [user]);

  useEffect(() => {
    void estimateCompanionStorageBytes().then(setStorageBytes);
  }, [downloadedCount, checking]);

  async function handleResetLocalCache() {
    setResettingCache(true);
    setResetMessage(null);
    setError(null);
    try {
      await resetLocalRaceCache();
      setResetMessage("Local race cache cleared. Tap Check for updates to re-download.");
      const bytes = await estimateCompanionStorageBytes();
      setStorageBytes(bytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cache reset failed.");
    } finally {
      setResettingCache(false);
    }
  }

  async function handleSignOut() {
    setError(null);
    setSigningOut(true);
    try {
      await signOut();
      await clearCompanionData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign out failed.");
    } finally {
      setSigningOut(false);
    }
  }

  async function handleDeleteAccount() {
    setSigningOut(true);
    try {
      await clearCompanionData();
      await signOut();
      setDeleteStep(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-y-auto px-4 pb-4 pt-safe-top`}
    >
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center gap-4">
          <Avatar name={displayName} imageUrl={avatarUrl} size="lg" variant="dark" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-white">{displayName}</p>
            <p className="truncate text-sm text-white/50">{user?.email}</p>
            {connectedSince ? (
              <p className="mt-1 text-xs text-white/35">Connected since {connectedSince}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 space-y-3 border-t border-white/8 pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Google account</span>
            <span className="font-medium text-white">
              {authProvider === "Google" ? user?.email : authProvider}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Desktop connected</span>
            <span className="font-medium text-white">{desktopConnected}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Companion connected</span>
            <span className="font-medium text-white">{companionConnected}</span>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/40">App</h2>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Version</span>
            <button
              type="button"
              onClick={revealDevTools}
              className="font-medium tabular-nums text-white"
              aria-label="App version"
            >
              {versionLabel}
            </button>
          </div>
          {updateAvailable && pendingVersionLabel ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/50">Update</span>
              <button
                type="button"
                disabled={applyingUpdate}
                onClick={() => void applyUpdate()}
                className="font-medium tabular-nums text-sky-300 transition hover:text-sky-200 disabled:opacity-60"
              >
                {versionLabel} → {pendingVersionLabel} available
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/40">Sync</h2>
          <SyncStatusBadge status={syncStatus} variant="dark" />
        </div>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Races in cloud</span>
            <span className="font-medium text-white">{cloudRaceCount ?? cloudRaces.length}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Downloaded races</span>
            <span className="font-medium text-white">{downloadedCount}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Cloud version</span>
            <span className="font-medium text-white">
              {maxCloudRevision != null ? `v${maxCloudRevision}` : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Phone version</span>
            <span className="font-medium text-white">
              {maxDownloadedRevision != null ? `v${maxDownloadedRevision}` : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Updates available</span>
            <span className={`font-medium ${updatesAvailable > 0 ? "text-orange-300" : "text-white"}`}>
              {updatesAvailable > 0 ? updatesAvailable : "None"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Last checked</span>
            <span className="font-medium text-white">{lastCheckLabel}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Last sync</span>
            <span className="font-medium text-white">{lastSyncLabel}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Storage used</span>
            <span className="font-medium text-white">{formatBytes(storageBytes)}</span>
          </div>
        </div>

        {checkProgress ? (
          <div className="mt-4 rounded-xl bg-white/5 px-3 py-3">
            <div className="mb-2 flex items-center justify-between text-[11px] text-white/55">
              <span>
                Downloading {checkProgress.raceName} ({checkProgress.current}/{checkProgress.total})
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-sky-400 transition-all duration-200"
                style={{ width: `${(checkProgress.current / checkProgress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        {checkMessage ? (
          <p className="mt-4 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {checkMessage}
          </p>
        ) : null}

        {updateResults.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-white/55">
            {updateResults.map((result) => (
              <li key={result.raceId} className="flex justify-between gap-3">
                <span className="truncate">{result.name}</span>
                <span className={result.status === "failed" ? "text-red-300" : "text-emerald-300"}>
                  {result.status === "failed" ? result.error ?? "Failed" : "Downloaded"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {(syncError || error) && (
          <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {syncError ?? error}
          </p>
        )}

        <button
          type="button"
          disabled={checking}
          onClick={() => void checkForUpdates().catch(() => undefined)}
          className="mt-5 min-h-[48px] w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
        >
          {checking ? "Checking for updates…" : "Check for updates"}
        </button>
      </section>

      {devToolsVisible ? (
      <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/40">Developer</h2>
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          Reset IndexedDB, cached bundles, service worker caches, and route metadata without a
          Safari hard refresh.
        </p>
        {resetMessage ? (
          <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {resetMessage}
          </p>
        ) : null}
        <button
          type="button"
          disabled={resettingCache}
          onClick={() => void handleResetLocalCache()}
          className="mt-4 min-h-[44px] rounded-xl border border-amber-400/30 px-5 py-2.5 text-sm font-medium text-amber-200 disabled:opacity-50"
        >
          {resettingCache ? "Resetting…" : "Reset Local Race Cache"}
        </button>
      </section>
      ) : null}

      <section className="mt-4 rounded-2xl border border-red-500/20 bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white">Account actions</h2>
        <p className="mt-1 text-xs text-white/45">Sign out or remove local data from this device.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
            className="min-h-[44px] rounded-xl border border-white/12 px-5 py-2.5 text-sm font-medium text-white/80"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => setDeleteStep(1)}
            className="min-h-[44px] rounded-xl border border-red-500/30 px-5 py-2.5 text-sm font-medium text-red-300"
          >
            Delete account
          </button>
        </div>
      </section>

      <DeleteAccountDialog
        open={deleteStep > 0}
        step={deleteStep === 2 ? 2 : 1}
        busy={signingOut}
        onClose={() => setDeleteStep(0)}
        onContinue={() => setDeleteStep(2)}
        onConfirm={() => void handleDeleteAccount()}
      />

    </div>
  );
}
