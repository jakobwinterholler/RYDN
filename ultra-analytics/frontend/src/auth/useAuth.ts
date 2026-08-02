import { useCallback, useEffect, useState } from "react";
import {
  devLogin,
  getAuthConfig,
  getMe,
  getProviders,
  logout,
  markOnboarded,
  redeemSubscriptionCode,
  updateProfile,
  type RedeemResult,
} from "../api";
import { clearOnboardingSeen } from "../onboarding/persistence";
import type { AuthConfig, Provider, User } from "../types";

export interface AuthState {
  loading: boolean;
  config: AuthConfig | null;
  user: User | null;
  providers: Provider[];
  error: string | null;
  refreshUser: () => Promise<void>;
  refreshProviders: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  updateUserProfile: (patch: { weightKg?: number | null }) => Promise<User>;
  redeemCode: (code: string) => Promise<RedeemResult>;
  signInDev: () => Promise<void>;
  signInGoogle: () => void;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      setProviders(await getProviders());
    } catch {
      setProviders([]);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [cfg, me] = await Promise.all([getAuthConfig(), getMe()]);
      setConfig(cfg);
      setUser(me);
      if (me) await loadProviders();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadProviders]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshUser = useCallback(async () => {
    setUser(await getMe());
  }, []);

  const completeOnboarding = useCallback(async () => {
    try {
      setUser(await markOnboarded());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const updateUserProfile = useCallback(async (patch: { weightKg?: number | null }) => {
    const next = await updateProfile(patch);
    setUser(next);
    return next;
  }, []);

  const redeemCode = useCallback(async (code: string) => {
    const redeemed = await redeemSubscriptionCode(code);
    // Re-read /api/auth/me so the shell always reflects persisted tier.
    const me = await getMe();
    if (!me) throw new Error("Signed out — sign in again to see your plan.");
    setUser(me);
    return { ...me, redeemAction: redeemed.redeemAction ?? null };
  }, []);

  const signInDev = useCallback(async () => {
    setError(null);
    try {
      setUser(await devLogin());
      await loadProviders();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [loadProviders]);

  const signInGoogle = useCallback(() => {
    window.location.href = "/api/auth/google/login";
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    clearOnboardingSeen();
    setUser(null);
    setProviders([]);
  }, []);

  return {
    loading,
    config,
    user,
    providers,
    error,
    refreshUser,
    refreshProviders: loadProviders,
    completeOnboarding,
    updateUserProfile,
    redeemCode,
    signInDev,
    signInGoogle,
    signOut,
  };
}
