import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { apiRequest, clearApiCache } from '../lib/api';
import { supabase, supabaseConfigured } from '../lib/supabase';
import type { AuthProfile } from '../types/api';

interface AuthState {
  ready: boolean;
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  updateProfile: (fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const PROFILE_KEY = 'btc_auth_profile_v3';

function storedProfile(): AuthProfile | null {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') as AuthProfile | null; }
  catch { return null; }
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function resolveRole(...values: unknown[]): string {
  const roles = values.map(value => String(value ?? '').trim().toLowerCase()).filter(Boolean);
  // Keep frontend authorization semantics aligned with backend require_admin:
  // a signed admin role in either profile or app_metadata is sufficient.
  if (roles.includes('admin')) return 'admin';
  return roles[0] || 'user';
}

function roleFromUser(user: User | null | undefined): string {
  return resolveRole(user?.app_metadata?.role, user?.user_metadata?.role);
}

function isSameProfileUser(candidate: AuthProfile | null, user: User | null | undefined): boolean {
  if (!candidate || !user) return false;
  const candidateId = firstText(candidate.user_id, candidate.id);
  return Boolean(candidateId && candidateId === user.id);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!supabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(() => storedProfile());
  const mounted = useRef(true);

  const saveProfile = useCallback((next: AuthProfile | null) => {
    if (!mounted.current) return;
    setProfile(next);
    if (next) localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    else localStorage.removeItem(PROFILE_KEY);
  }, []);

  const loadProfile = useCallback(async (knownUser?: User | null) => {
    if (!supabase) return;

    let currentUser = knownUser || null;
    if (!currentUser) currentUser = (await supabase.auth.getUser()).data.user;
    if (!currentUser) {
      saveProfile(null);
      return;
    }

    try {
      const result = await apiRequest<{
        user_id?: string;
        email?: string;
        role?: string;
        status?: string;
        profile?: AuthProfile;
      }>('/api/auth/me', { force: true, cacheTtl: 0 });

      const apiProfile = result.profile || {};
      const merged: AuthProfile = {
        ...apiProfile,
        user_id: firstText(result.user_id, apiProfile.user_id, apiProfile.id, currentUser.id),
        email: firstText(result.email, apiProfile.email, currentUser.email),
        full_name: firstText(
          apiProfile.full_name,
          apiProfile.display_name,
          currentUser.user_metadata?.full_name,
          currentUser.user_metadata?.name,
        ),
        // Do not overwrite an admin role with undefined. Admin role may live in
        // user_profiles, app_metadata, or legacy user_metadata.
        role: resolveRole(result.role, apiProfile.role, roleFromUser(currentUser)),
        status: firstText(result.status, apiProfile.status, 'active').toLowerCase(),
      };
      saveProfile(merged);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('suspend')) {
        await supabase.auth.signOut({ scope: 'local' });
        saveProfile(null);
        return;
      }

      // A temporary backend/CORS outage must not visually downgrade a valid
      // admin. Supabase app_metadata is signed and cannot be edited by users.
      const cached = storedProfile();
      const sameUserCache = isSameProfileUser(cached, currentUser) ? cached : null;
      const fallback: AuthProfile = {
        ...(sameUserCache || {}),
        user_id: currentUser.id,
        email: firstText(currentUser.email, sameUserCache?.email),
        full_name: firstText(
          currentUser.user_metadata?.full_name,
          currentUser.user_metadata?.name,
          sameUserCache?.full_name,
          sameUserCache?.display_name,
        ),
        role: resolveRole(roleFromUser(currentUser), sameUserCache?.role),
        status: firstText(sameUserCache?.status, 'active').toLowerCase(),
      };
      saveProfile(fallback);
    }
  }, [saveProfile]);

  useEffect(() => {
    mounted.current = true;
    if (!supabase) {
      setReady(true);
      return () => { mounted.current = false; };
    }

    setReady(false);
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted.current) return;
      const nextSession = data.session;
      setSession(nextSession);

      if (nextSession) {
        const cached = storedProfile();
        if (!isSameProfileUser(cached, nextSession.user)) saveProfile(null);
        await loadProfile(nextSession.user);
      } else {
        saveProfile(null);
      }

      if (mounted.current) setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Supabase advises against awaiting other auth calls directly inside this
      // callback. Schedule the async profile resolution outside the callback.
      window.setTimeout(() => {
        void (async () => {
          if (!mounted.current) return;
          setReady(false);
          setSession(nextSession);
          clearApiCache();

          if (nextSession) {
            const cached = storedProfile();
            if (!isSameProfileUser(cached, nextSession.user)) saveProfile(null);
            await loadProfile(nextSession.user);
          } else {
            saveProfile(null);
          }

          if (mounted.current) setReady(true);
        })();
      }, 0);
    });

    return () => {
      mounted.current = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile, saveProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase Auth chưa được cấu hình.');
    setReady(false);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setReady(true);
      throw error;
    }
    setSession(data.session);
    await loadProfile(data.user);
    setReady(true);
  }, [loadProfile]);

  const sendOtp = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase Auth chưa được cấu hình.');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (email: string, token: string) => {
    if (!supabase) throw new Error('Supabase Auth chưa được cấu hình.');
    setReady(false);
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      setReady(true);
      throw error;
    }
    setSession(data.session);
    await loadProfile(data.user);
    setReady(true);
  }, [loadProfile]);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Supabase Auth chưa được cấu hình.');
    const { error } = await supabase.auth.updateUser({
      password,
      data: { password_set: true, password_updated_at: new Date().toISOString() },
    });
    if (error) throw error;
    // Refreshing the profile preserves the server-side admin role after a
    // password update and updates password_set when the backend exposes it.
    await loadProfile();
  }, [loadProfile]);

  const updateProfile = useCallback(async (fullName: string) => {
    if (!supabase) throw new Error('Supabase Auth chưa được cấu hình.');
    const { error } = await supabase.auth.updateUser({ data: { full_name: fullName, name: fullName } });
    if (error) throw error;
    setProfile(current => {
      const next = { ...(current || {}), full_name: fullName } as AuthProfile;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const signOut = useCallback(async () => {
    clearApiCache();
    saveProfile(null);
    setSession(null);
    if (!supabase) return;

    const timeout = new Promise<void>(resolve => window.setTimeout(resolve, 2500));
    const logout = supabase.auth.signOut({ scope: 'local' }).then(() => undefined).catch(() => undefined);
    await Promise.race([logout, timeout]);

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) localStorage.removeItem(key);
    }
  }, [saveProfile]);

  const resolvedRole = resolveRole(
    profile?.role,
    session?.user.app_metadata?.role,
    session?.user.user_metadata?.role,
  );

  const value = useMemo<AuthState>(() => ({
    ready,
    session,
    user: session?.user || null,
    profile,
    isAuthenticated: Boolean(session),
    isAdmin: resolvedRole === 'admin',
    signIn,
    sendOtp,
    verifyOtp,
    updatePassword,
    updateProfile,
    signOut,
    refreshProfile: async () => loadProfile(session?.user),
  }), [ready, session, profile, resolvedRole, signIn, sendOtp, verifyOtp, updatePassword, updateProfile, signOut, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
