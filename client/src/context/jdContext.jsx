import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// One JD lives in App-level state + localStorage so the same paste flows from
// the Tailor tab → Templates AI Tailor modal → Compose JDMatcher without the
// user re-pasting. Components read via `useJd()` and write via `setJd(value)`.

const STORAGE_KEY = "coldmail.currentJd";

const JdContext = createContext({
  jd: "",
  setJd: () => {},
  clearJd: () => {},
});

function readFromStorage() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeToStorage(value) {
  try {
    if (value && value.trim()) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore (private mode, quota, etc.) — context still holds the value in memory
  }
}

export function JdProvider({ children }) {
  const [jd, setJdState] = useState(readFromStorage);

  // Keep tabs in sync if the user opens the app twice — `storage` events fire
  // in OTHER tabs when one tab writes.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setJdState(e.newValue || "");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setJd = useCallback(
    (next) => {
      const value = typeof next === "function" ? next(jd) : next || "";
      setJdState(value);
      writeToStorage(value);
    },
    [jd],
  );

  const clearJd = useCallback(() => setJd(""), [setJd]);

  return (
    <JdContext.Provider value={{ jd, setJd, clearJd }}>
      {children}
    </JdContext.Provider>
  );
}

export function useJd() {
  return useContext(JdContext);
}
