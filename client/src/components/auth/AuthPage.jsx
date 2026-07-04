import { useState } from "react";
import toast from "react-hot-toast";

import { useAuth } from "../../context/authContext.jsx";

export default function AuthPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isSignup = mode === "signup";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (isSignup) {
        await signup(name.trim(), email.trim(), password);
        toast.success("Account created — welcome!");
      } else {
        await login(email.trim(), password);
        toast.success("Signed in.");
      }
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(isSignup ? "login" : "signup");
    setError("");
    setPassword("");
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-ui-app px-4 py-10">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
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
          <div>
            <h1 className="text-lg font-semibold text-ui-fg">coldMail</h1>
            <p className="text-xs text-ui-fg-muted">
              {isSignup ? "Create your account" : "Sign in to continue"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignup && (
            <div>
              <label className="label" htmlFor="auth-name">
                Name
              </label>
              <input
                id="auth-name"
                className="input"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div>
            <label className="label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              className="input"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={isSignup ? 8 : undefined}
              required
            />
            {isSignup && (
              <p className="help mt-1">At least 8 characters.</p>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-200/70 dark:bg-rose-500/10 dark:text-rose-200">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="mt-5 text-center text-xs text-ui-fg-muted">
          {isSignup ? "Already have an account?" : "New to coldMail?"}{" "}
          <button
            type="button"
            onClick={switchMode}
            className="font-semibold text-brand-600 hover:underline"
          >
            {isSignup ? "Sign in" : "Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}
