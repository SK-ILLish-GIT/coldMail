import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { api } from "./lib/api.js";
import { tabClick, tabMouseDown } from "./lib/tabButton.js";
import { TailorTargetProvider } from "./lib/tailorTarget.jsx";
import EmailForm from "./components/EmailForm.jsx";
import TemplateLibrary from "./components/TemplateLibrary.jsx";
import ResumeLibrary from "./components/ResumeLibrary.jsx";
import SentLog from "./components/SentLog.jsx";
import AppFooter from "./components/AppFooter.jsx";
import HeaderSettingsMenu from "./components/HeaderSettingsMenu.jsx";
import TailorPage from "./components/Tailor/TailorPage.jsx";
import { useTheme } from "./components/ThemeToggle.jsx";

const TABS = [
  { id: "compose", label: "Compose" },
  { id: "templates", label: "Templates" },
  { id: "resumes", label: "Resumes" },
  { id: "tailor", label: "Tailor" },
  { id: "log", label: "Drafts Log" },
];

const TAB_IDS = new Set(TABS.map((t) => t.id));

// Hash-based tab routing: refreshing keeps the tab, browser back/forward
// works, deep-link to a tab from anywhere by setting `location.hash`.
function readTabFromHash() {
  if (typeof window === "undefined") return "compose";
  const hash = window.location.hash.replace(/^#/, "");
  return TAB_IDS.has(hash) ? hash : "compose";
}

export default function App() {
  const [tab, setTabState] = useState(readTabFromHash);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [activeResume, setActiveResume] = useState(null);
  const [theme, setTheme] = useTheme();
  const [health, setHealth] = useState({
    loading: true,
    ok: false,
    storage: "mongodb",
    features: { aiEnrich: false },
  });

  const refreshHealth = async () => {
    try {
      const h = await api.health();
      setHealth({ loading: false, ok: Boolean(h.ok), ...h });
    } catch {
      setHealth((prev) => ({ ...prev, loading: false, ok: false }));
    }
  };

  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 60_000);
    return () => clearInterval(id);
  }, []);

  // Sync tab → URL hash, and listen for back/forward.
  useEffect(() => {
    const onHash = () => setTabState(readTabFromHash());
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  // Update the URL hash when the user clicks a tab. Use pushState so back
  // navigates to the previous tab instead of out of the app.
  const setTab = useCallback((next) => {
    if (!TAB_IDS.has(next)) return;
    if (typeof window !== "undefined" && window.location.hash !== `#${next}`) {
      window.history.pushState(null, "", `#${next}`);
    }
    setTabState(next);
  }, []);

  // Initial hash sync: if the page loaded without a hash, write the default
  // so reloads stay stable.
  const hashSyncedRef = useRef(false);
  useEffect(() => {
    if (hashSyncedRef.current) return;
    hashSyncedRef.current = true;
    if (typeof window !== "undefined" && !window.location.hash) {
      window.history.replaceState(null, "", `#${tab}`);
    }
  }, [tab]);

  const handleUseTemplate = (tpl) => {
    setActiveTemplate(tpl);
    setTab("compose");
  };

  const handleUseResume = (resume) => {
    if (!resume?.id) return;
    setActiveResume(resume);
    setTab("compose");
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  // Click handler for the AI status pill: copy the env hint when AI is off
  // so the user can paste it straight into server/.env. Better than a static
  // tooltip that nobody reads.
  const handleAiPillClick = () => {
    if (health.features?.aiEnrich) return;
    const hint = "GEMINI_API_KEY=";
    try {
      navigator.clipboard?.writeText(hint);
      toast.success(
        "Copied GEMINI_API_KEY= — paste into server/.env, then restart.",
        {
          duration: 5000,
        },
      );
    } catch {
      toast("Set GEMINI_API_KEY in server/.env, then restart.", { icon: "ℹ️" });
    }
  };

  return (
    <TailorTargetProvider onRequestTab={setTab}>
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 border-b border-ui-border/80 bg-ui-panel/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3.5">
            <div className="flex items-center gap-3">
              <div className="icon-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-md">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="M2.5 6.5l9.5 6 9.5-6" />
                  <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-semibold leading-tight text-ui-fg">
                  coldMail
                </h1>
                <p className="truncate text-xs text-ui-fg-muted">
                  Personalised email campaigns, sent right.
                </p>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
              <nav className="tabs tabs-scroll" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onMouseDown={tabMouseDown}
                    onClick={tabClick(() => setTab(t.id))}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={[
                      "tab",
                      "whitespace-nowrap",
                      tab === t.id && "tab-active",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              <HeaderSettingsMenu
                health={health}
                theme={theme}
                onToggleTheme={toggleTheme}
                onAiPillClick={handleAiPillClick}
              />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {tab === "compose" && (
            <EmailForm
              initialTemplate={activeTemplate}
              onClearTemplate={() => setActiveTemplate(null)}
              initialResume={activeResume}
              onClearResume={() => setActiveResume(null)}
              aiEnabled={Boolean(health.features?.aiEnrich)}
            />
          )}
          {tab === "templates" && (
            <TemplateLibrary
              onUseTemplate={handleUseTemplate}
              aiEnabled={Boolean(health.features?.aiEnrich)}
            />
          )}
          {tab === "resumes" && (
            <ResumeLibrary
              onUseResume={handleUseResume}
              aiEnabled={Boolean(health.features?.aiEnrich)}
            />
          )}
          {tab === "tailor" && (
            <TailorPage
              aiConfigured={
                Boolean(health.features?.resumeTailor) ||
                Boolean(health.features?.aiEnrich)
              }
            />
          )}
          {tab === "log" && <SentLog />}
        </main>

        <AppFooter />
      </div>
    </TailorTargetProvider>
  );
}
