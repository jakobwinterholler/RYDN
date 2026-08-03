import { useEffect, useRef, useState } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import {
  getAuthProviderLabel,
  getAvatarUrl,
  getConnectedSince,
  getDisplayName,
} from "@shared/auth/profile";
import { GoogleSignInButton } from "@shared/ui/GoogleSignInButton";
import { Avatar, SigningInScreen } from "@shared/ui/AuthScreens";
import { SyncStatusBadge, type SyncIndicator } from "@shared/ui/SyncStatusBadge";
import { formatDeviceLastActive } from "@shared/sync/deviceActivity";
import { readDevicesFromMetadata, updateDeviceLastActive } from "@shared/sync/deviceProfile";
import { companionConnectionLabel } from "@shared/ui/accountDevices";
import type { AccountSettings } from "../../settings/types";
import { formatStorage } from "@shared/ui/formatStorage";
import { useAccountSync } from "../../sync/useAccountSync";

interface AccountSectionProps {
  account: AccountSettings;
}

function FeatureRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-sm text-muted">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
        ✓
      </span>
      {children}
    </li>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{value}</span>
    </div>
  );
}

function DeleteAccountModal({
  open,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) {
      setStep(1);
      setTyped("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const canConfirm = typed.trim().toUpperCase() === "DELETE" && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-card animate-fade-in">
        {step === 1 ? (
          <>
            <h3 className="text-lg font-semibold text-ink">Delete account?</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              This signs you out on all devices and removes local sync data from this computer.
              To permanently delete your cloud account and races, contact support.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={busy}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-ink">Confirm deletion</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Type <span className="font-mono font-semibold text-ink">DELETE</span> to confirm
              removing your account from this device.
            </p>
            <input
              type="text"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              placeholder="DELETE"
              className="mt-4 w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!canConfirm}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Signing out…" : "Delete account"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function resolveSyncStatus(input: {
  syncing: boolean;
  hasPending: boolean;
  syncError: string | null;
  signedIn: boolean;
  cloudEnabled: boolean;
}): SyncIndicator | null {
  if (!input.signedIn || !input.cloudEnabled) {
    return null;
  }
  if (input.syncing) {
    return "syncing";
  }
  if (input.syncError || input.hasPending) {
    return "waiting-to-sync";
  }
  return "cloud-synced";
}

export default function AccountSection({ account }: AccountSectionProps) {
  const {
    configured,
    user,
    signingIn,
    signInWithGoogle,
    signOut,
    authError: oauthError,
  } = useAuth();
  const {
    syncing,
    cloudRaceCount,
    maxCloudRevision,
    lastSyncLabel,
    syncError,
    syncMessage,
    hasPending,
    syncProgress,
    raceResults,
    syncToCompanion,
  } = useAccountSync();
  const [localError, setLocalError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const deviceRecorded = useRef(false);

  const displayName = getDisplayName(user);
  const avatarUrl = getAvatarUrl(user);
  const connectedSince = getConnectedSince(user);
  const authProvider = getAuthProviderLabel(user);
  const devices = readDevicesFromMetadata(user?.user_metadata);
  const companionConnected = companionConnectionLabel(devices);

  const syncStatus = resolveSyncStatus({
    syncing,
    hasPending,
    syncError,
    signedIn: Boolean(user),
    cloudEnabled: account.cloud_sync_enabled,
  });

  useEffect(() => {
    if (!user || deviceRecorded.current) {
      return;
    }
    deviceRecorded.current = true;
    void updateDeviceLastActive("desktop");
  }, [user]);

  async function handleSignIn() {
    setLocalError(null);
    setRedirecting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Sign in failed.");
      setRedirecting(false);
    }
  }

  async function handleSignOut() {
    setLocalError(null);
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Sign out failed.");
    } finally {
      setSigningOut(false);
    }
  }

  async function handleDeleteAccount() {
    setSigningOut(true);
    try {
      localStorage.removeItem(`cloud-sync-imported:${user?.id ?? ""}`);
      await signOut();
      setShowDelete(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not sign out.");
    } finally {
      setSigningOut(false);
    }
  }

  const authError = localError ?? oauthError;

  if (signingIn) {
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        <SigningInScreen message="Signing you in…" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="animate-fade-in">
        <div className="mx-auto max-w-lg rounded-2xl border border-line bg-card px-8 py-12 text-center shadow-card">
          <h2 className="text-3xl font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-muted">
            Sign in to automatically sync your races between your computer and your phone.
          </p>

          <div className="mt-8 flex justify-center">
            <GoogleSignInButton
              onClick={() => void handleSignIn()}
              disabled={!configured}
              loading={redirecting}
            />
          </div>

          {!configured ? (
            <p className="mt-4 text-xs text-muted">
              Cloud sign-in requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
            </p>
          ) : null}

          {authError ? (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{authError}</p>
          ) : null}

          <ul className="mx-auto mt-10 max-w-xs space-y-3 text-left">
            <FeatureRow>Automatic cloud sync</FeatureRow>
            <FeatureRow>Your races on every device</FeatureRow>
            <FeatureRow>Offline Companion app</FeatureRow>
            <FeatureRow>Secure Google authentication</FeatureRow>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <section className="rounded-2xl border border-line bg-card p-8 shadow-card">
        <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left">
          <Avatar name={displayName} imageUrl={avatarUrl} size="xl" />
          <div className="mt-5 sm:mt-0 sm:ml-6">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">{displayName}</h2>
            <p className="mt-1 text-sm text-muted">{user.email}</p>
            {connectedSince ? (
              <p className="mt-2 text-xs text-muted">Connected since {connectedSince}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-8 divide-y divide-line/70 border-t border-line/70">
          <StatRow label="Google account" value={authProvider === "Google" ? user.email : authProvider} />
          <StatRow
            label="Companion connected"
            value={companionConnected}
          />
          <StatRow label="Races" value={cloudRaceCount ?? account.storage.race_count} />
          <StatRow label="Storage used" value={formatStorage(account.storage.storage_bytes)} />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-ink">Cloud sync</h3>
          {syncStatus ? <SyncStatusBadge status={syncStatus} /> : null}
        </div>

        <div className="mt-4 divide-y divide-line/70">
          <StatRow label="Last sync" value={lastSyncLabel} />
          <StatRow label="Races in cloud" value={cloudRaceCount ?? "—"} />
          <StatRow label="Cloud version" value={maxCloudRevision != null ? `v${maxCloudRevision}` : "—"} />
        </div>

        {syncProgress ? (
          <div className="mt-4 rounded-xl bg-canvas px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted">
              <span>
                Uploading {syncProgress.raceName} ({syncProgress.current}/{syncProgress.total})
              </span>
              <span>{Math.round((syncProgress.current / syncProgress.total) * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line/60">
              <div
                className="h-full rounded-full bg-accent transition-all duration-200"
                style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        {syncMessage ? (
          <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{syncMessage}</p>
        ) : null}

        {raceResults.length > 0 ? (
          <ul className="mt-4 space-y-2 rounded-xl border border-line/70 bg-canvas px-4 py-3 text-sm">
            {raceResults.map((result) => (
              <li key={result.raceId} className="flex items-center justify-between gap-3">
                <span className="truncate text-ink">{result.name}</span>
                <span
                  className={
                    result.status === "success" || result.status === "skipped"
                      ? "shrink-0 text-success"
                      : "shrink-0 text-red-600"
                  }
                >
                  {result.status === "success"
                    ? `Uploaded v${result.companionRevision ?? "?"} ✓`
                    : result.status === "skipped"
                      ? `Already in cloud v${result.companionRevision ?? "?"} ✓`
                      : result.error ?? "Failed"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {(syncError || authError) && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {syncError ?? authError}
          </p>
        )}

        <button
          type="button"
          disabled={!account.cloud_sync_enabled || syncing}
          onClick={() => void syncToCompanion().catch(() => undefined)}
          className="mt-5 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? "Syncing to phone…" : "Sync to Phone"}
        </button>

        {!account.cloud_sync_enabled ? (
          <p className="mt-3 text-xs text-muted">
            Add Supabase credentials to enable race uploads to the cloud.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-line bg-card p-6 shadow-card">
        <h3 className="text-lg font-semibold text-ink">Devices</h3>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">This Mac</p>
              <p className="text-xs text-muted">Ultra Roadbook · Desktop</p>
            </div>
            <p className="text-xs text-muted">
              {formatDeviceLastActive(devices.desktop?.lastActive ?? new Date().toISOString())}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">Companion</p>
              <p className="text-xs text-muted">
                {companionConnected === "Yes" ? "Connected" : "Race day app"}
              </p>
            </div>
            <p className="text-xs text-muted">
              {formatDeviceLastActive(devices.companion?.lastActive)}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-red-200 bg-card p-6 shadow-card">
        <h3 className="text-lg font-semibold text-ink">Account actions</h3>
        <p className="mt-1 text-sm text-muted">Sign out or remove your account from this device.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => setShowDelete(true)}
            className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700"
          >
            Delete account
          </button>
        </div>
      </section>

      <DeleteAccountModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => void handleDeleteAccount()}
        busy={signingOut}
      />
    </div>
  );
}
