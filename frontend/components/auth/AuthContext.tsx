"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AuthResponse, User } from "@/lib/types";
import { getCurrentUser, login as apiLogin, signup as apiSignup } from "@/lib/api";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  signup: (params: {
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
  }) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = "cv_auth_token";
const USER_KEY = "cv_auth_user";

function persistAuth(auth: AuthResponse, remember: boolean) {
  if (!remember) {
    // In-memory only; nothing to persist.
    return;
  }
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, auth.token);
  window.localStorage.setItem(
    USER_KEY,
    JSON.stringify({
      id: auth.id,
      email: auth.email,
      first_name: auth.first_name,
      last_name: auth.last_name,
      date_joined: auth.date_joined,
    })
  );
}

function clearPersistedAuth() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate from localStorage on first client render.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedToken = window.localStorage.getItem(TOKEN_KEY);
    const storedUser = window.localStorage.getItem(USER_KEY);
    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as User;
        setToken(storedToken);
        setUser(parsedUser);
        // Optionally validate token against backend.
        getCurrentUser(storedToken)
          .then((freshUser) => {
            setUser(freshUser);
          })
          .catch(() => {
            // Token likely invalid/expired; clear state.
            clearPersistedAuth();
            setToken(null);
            setUser(null);
          })
          .finally(() => setLoading(false));
        return;
      } catch {
        clearPersistedAuth();
      }
    }
    setLoading(false);
  }, []);

  const handleAuthSuccess = useCallback(
    (auth: AuthResponse, remember: boolean) => {
      setToken(auth.token);
      setUser({
        id: auth.id,
        email: auth.email,
        first_name: auth.first_name,
        last_name: auth.last_name,
        date_joined: auth.date_joined,
      });
      persistAuth(auth, remember);
    },
    []
  );

  const login = useCallback<
    AuthContextValue["login"]
  >(async (email, password, remember) => {
    const auth = await apiLogin(email, password);
    handleAuthSuccess(auth, remember);
  }, [handleAuthSuccess]);

  const signup = useCallback<
    AuthContextValue["signup"]
  >(async (params) => {
    const auth = await apiSignup(params);
    // For signup we default to "remember me" behavior.
    handleAuthSuccess(auth, true);
  }, [handleAuthSuccess]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    clearPersistedAuth();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      login,
      signup,
      logout,
    }),
    [user, token, loading, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}


