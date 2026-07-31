import { useCallback, useEffect, useState } from "react";
import {
  devLogin,
  getAuthConfig,
  getMe,
  getProviders,
  logout,
  markOnboarded,
  updateProfile,
} from "../api";
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
    signInDev,
    signInGoogle,
    signOut,
  };
}
