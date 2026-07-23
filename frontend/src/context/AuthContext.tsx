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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!supabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(() => storedProfile());
  const mounted = useRef(true);

  const loadProfile = useCallback(async () => {
    if (!supabase) return;
    try {
      const result = await apiRequest<{ user_id?: string; email?: string; role?: string; status?: string; profile?: AuthProfile }>('/api/auth/me', { force: true, cacheTtl: 0 });
      const merged: AuthProfile = {
        ...(result.profile || {}),
        user_id: result.user_id,
        email: result.email,
        role: result.role,
        status: result.status,
      };
      if (!mounted.current) return;
      setProfile(merged);
      localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('suspend')) {
        await supabase.auth.signOut({ scope: 'local' });
      }
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (currentUser && mounted.current) {
        const fallback: AuthProfile = {
          user_id: currentUser.id,
          email: currentUser.email,
          full_name: String(currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || ''),
          role: String(currentUser.user_metadata?.role || 'user'),
          status: 'active',
        };
        setProfile(fallback);
        localStorage.setItem(PROFILE_KEY, JSON.stringify(fallback));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!supabase) {
      setReady(true);
      return () => { mounted.current = false; };
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted.current) return;
      setSession(data.session);
      if (data.session) void loadProfile();
      setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Avoid awaiting Supabase calls inside this callback. Scheduling the work
      // prevents the long-running-session sign-out deadlock observed in the old SPA.
      window.setTimeout(() => {
        if (!mounted.current) return;
        setSession(nextSession);
        clearApiCache();
        if (nextSession) void loadProfile();
        else {
          setProfile(null);
          localStorage.removeItem(PROFILE_KEY);
        }
        setReady(true);
      }, 0);
    });

    return () => {
      mounted.current = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase Auth chưa được cấu hình.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setSession(data.session);
    await loadProfile();
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
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
    setSession(data.session);
    await loadProfile();
  }, [loadProfile]);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Supabase Auth chưa được cấu hình.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

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
    localStorage.removeItem(PROFILE_KEY);
    setProfile(null);
    setSession(null);
    if (!supabase) return;

    const timeout = new Promise<void>(resolve => window.setTimeout(resolve, 2500));
    const logout = supabase.auth.signOut({ scope: 'local' }).then(() => undefined).catch(() => undefined);
    await Promise.race([logout, timeout]);

    // Last-resort cleanup for stale tabs/tokens. Supabase keys include the project
    // reference and start with sb-, so this does not remove unrelated app data.
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) localStorage.removeItem(key);
    }
  }, []);

  const value = useMemo<AuthState>(() => ({
    ready,
    session,
    user: session?.user || null,
    profile,
    isAuthenticated: Boolean(session),
    isAdmin: String(profile?.role || session?.user.user_metadata?.role || '').toLowerCase() === 'admin',
    signIn,
    sendOtp,
    verifyOtp,
    updatePassword,
    updateProfile,
    signOut,
    refreshProfile: loadProfile,
  }), [ready, session, profile, signIn, sendOtp, verifyOtp, updatePassword, updateProfile, signOut, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
