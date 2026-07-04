import axios from "axios";

// The access token lives ONLY in memory (never localStorage) so it is not
// exposed to XSS-persisted theft. The long-lived refresh token is an httpOnly
// cookie the browser manages; we can't read it from JS by design.
const baseURL = import.meta.env.VITE_API_BASE_URL || "/api";

let accessToken = null;
let onAuthFailure = null;
let refreshPromise = null;

export function getAccessToken() {
  return accessToken;
}
export function setAccessToken(token) {
  accessToken = token || null;
}
export function clearAccessToken() {
  accessToken = null;
}
/** AuthProvider registers this so a failed refresh forces the UI to log out. */
export function setAuthFailureHandler(fn) {
  onAuthFailure = fn;
}

// Bare client with no interceptors, used solely for the refresh call so it
// can't recurse into the 401 -> refresh handler below.
const refreshClient = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 30_000,
});

/**
 * Exchange the httpOnly refresh cookie for a new access token. Concurrent
 * callers share a single in-flight request.
 */
export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post("/auth/refresh")
      .then((res) => {
        accessToken = res.data?.accessToken || null;
        return accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// A 401 on these endpoints is terminal (they ARE the auth flow), so don't try
// to refresh-and-retry them.
const NO_REFRESH = ["/auth/login", "/auth/signup", "/auth/refresh", "/auth/logout"];
function isNoRefresh(url = "") {
  return NO_REFRESH.some((p) => url.includes(p));
}

/**
 * Attach the Bearer access token to outgoing requests and transparently
 * refresh + retry once on a 401. Call for each axios instance.
 */
export function installAuthInterceptors(client) {
  client.interceptors.request.use((config) => {
    if (accessToken) {
      config.headers = config.headers || {};
      config.headers["Authorization"] = `Bearer ${accessToken}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error.config;
      const status = error.response?.status;
      if (
        status === 401 &&
        original &&
        !original._retry &&
        !isNoRefresh(original.url)
      ) {
        original._retry = true;
        try {
          const token = await refreshAccessToken();
          if (token) {
            original.headers = original.headers || {};
            original.headers["Authorization"] = `Bearer ${token}`;
            return client.request(original);
          }
        } catch {
          /* refresh failed — fall through to logout */
        }
        clearAccessToken();
        if (onAuthFailure) onAuthFailure();
      }
      return Promise.reject(error);
    },
  );
}
