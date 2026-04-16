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
import { clearAllDashboardCaches } from "@/lib/dashboardListCache";
import {
  getCurrentUser,
  getInMemoryAccessToken,
  login as apiLogin,
  logout as apiLogout,
  renewAccessToken,
  signup as apiSignup,
} from "@/lib/api";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Boot auth state on app load: renew first, then call /me with fresh token.
  useEffect(() => {
    renewAccessToken({ silent: true })
      .then((auth) => {
        const tokenFromMemory = getInMemoryAccessToken() || auth.access_token;
        return getCurrentUser(tokenFromMemory).then((freshUser) => {
          setToken(tokenFromMemory);
          setUser(freshUser);
        });
      })
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleAuthSuccess = useCallback(
    (auth: AuthResponse) => {
      clearAllDashboardCaches();
      setToken(auth.access_token);
      setUser({
        id: auth.id,
        email: auth.email,
        first_name: auth.first_name,
        last_name: auth.last_name,
        date_joined: auth.date_joined,
        role: auth.role,
      });
    },
    []
  );

  const login = useCallback<
    AuthContextValue["login"]
  >(async (email, password) => {
    const auth = await apiLogin(email, password);
    handleAuthSuccess(auth);
  }, [handleAuthSuccess]);

  const signup = useCallback<
    AuthContextValue["signup"]
  >(async (params) => {
    const auth = await apiSignup(params);
    handleAuthSuccess(auth);
  }, [handleAuthSuccess]);

  const logout = useCallback(() => {
    clearAllDashboardCaches();
    setToken(null);
    setUser(null);
    apiLogout().catch(() => {
      // Ignore logout failures; frontend state is already cleared.
    });
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


