import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { api } from "../lib/api.js";
import {
  setAccessToken,
  clearAccessToken,
  refreshAccessToken,
  setAuthFailureHandler,
} from "../lib/authToken.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On load the in-memory access token is gone (page reload), so try to
  // silently restore the session from the httpOnly refresh cookie.
  useEffect(() => {
    setAuthFailureHandler(() => setUser(null));
    let cancelled = false;
    (async () => {
      try {
        const token = await refreshAccessToken();
        if (token && !cancelled) {
          const { user: me } = await api.me();
          if (!cancelled) setUser(me);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const { accessToken, user: u } = await api.login({ email, password });
    setAccessToken(accessToken);
    setUser(u);
    return u;
  }, []);

  const signup = useCallback(async (name, email, password) => {
    const { accessToken, user: u } = await api.signup({ name, email, password });
    setAccessToken(accessToken);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* best-effort; clear locally regardless */
    }
    clearAccessToken();
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const { user: u } = await api.updateProfile(patch);
    setUser(u);
    return u;
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { accessToken } = await api.changePassword({
      currentPassword,
      newPassword,
    });
    if (accessToken) setAccessToken(accessToken);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, signup, logout, updateProfile, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
