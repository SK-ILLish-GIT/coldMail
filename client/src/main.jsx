import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";

import App from "./App.jsx";
import { JdProvider } from "./context/jdContext.jsx";
import { AuthProvider } from "./context/authContext.jsx";
import "./index.css";

// Sync the theme class on <html> BEFORE React mounts. This avoids the
// double-render flash and also prevents HMR/fast-refresh from leaving the
// `dark` class stuck on <html> while the React state thinks light.
(function syncInitialTheme() {
  try {
    const saved = window.localStorage.getItem("coldmail.theme");
    const isDark = saved === "dark";
    if (isDark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  } catch {
    document.documentElement.classList.remove("dark");
  }
})();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <JdProvider>
        <App />
      </JdProvider>
    </AuthProvider>
    <Toaster
      position="top-right"
      toastOptions={{
        className: "!bg-ui-panel !text-ui-fg !border !border-ui-border/80 !shadow-lift",
        style: { borderRadius: "10px" },
        success: {
          iconTheme: {
            primary: "#22c55e",
            secondary: "rgb(var(--cm-panel))",
          },
        },
        error: {
          iconTheme: {
            primary: "#ef4444",
            secondary: "rgb(var(--cm-panel))",
          },
        },
      }}
    />
  </React.StrictMode>,
);
