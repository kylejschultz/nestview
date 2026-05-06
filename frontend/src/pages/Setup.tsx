import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import NestviewLogo from "../components/NestviewLogo";

interface SetupProps {
  onComplete: () => void;
}

export default function Setup({ onComplete }: SetupProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "none">("password");
  const [noAuthConfirmed, setNoAuthConfirmed] = useState(false);
  const [touched, setTouched] = useState({ username: false, password: false, confirmPassword: false });
  const [apiError, setApiError] = useState<string | null>(null);

  const usernameError = touched.username && username.trim().length === 0 ? "Username is required." :
    touched.username && username.trim().length > 64 ? "Username must be 64 characters or fewer." : null;
  const passwordError = touched.password && password.length === 0 ? "Password is required." :
    touched.password && password.length < 8 ? "Password must be at least 8 characters." : null;
  const confirmPasswordError = touched.confirmPassword && confirmPassword !== password ? "Passwords do not match." : null;

  const isValid =
    authMode === "none"
      ? noAuthConfirmed
      : username.trim().length > 0 &&
        username.trim().length <= 64 &&
        password.length >= 8 &&
        confirmPassword === password;

  const mutation = useMutation({
    mutationFn: () =>
      authMode === "none"
        ? api.auth.setup({ auth_mode: "none" })
        : api.auth.setup({ username: username.trim(), password, auth_mode: "password" }),
    onSuccess: () => {
      onComplete();
    },
    onError: (err: Error) => {
      setApiError(err.message);
    },
  });

  function handleSubmit() {
    if (authMode === "password") {
      setTouched({ username: true, password: true, confirmPassword: true });
    }
    if (!isValid) return;
    setApiError(null);
    mutation.mutate();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-1 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <NestviewLogo />
        </div>

        {/* Card */}
        <div className="bg-surface-2 border border-border rounded-xl p-8">
          <h1 className="text-xl font-semibold text-slate-100 mb-1">Welcome to Nestview</h1>
          <p className="text-sm text-slate-400 mb-6">Set up your dashboard to get started.</p>

          {/* Auth mode */}
          <div className="mb-6">
            <p className="text-sm font-medium text-slate-300 mb-2">Authentication mode</p>
            <div className="space-y-2">
              {/* Password required */}
              <button
                type="button"
                onClick={() => setAuthMode("password")}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  authMode === "password"
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface-3 hover:border-slate-500"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    authMode === "password" ? "border-accent" : "border-slate-500"
                  }`}>
                    {authMode === "password" && <div className="w-2 h-2 rounded-full bg-accent" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-100">Password required</p>
                    <p className="text-xs text-slate-400 mt-0.5">Protect the dashboard with your credentials.</p>
                  </div>
                </div>
              </button>

              {/* No authentication */}
              <button
                type="button"
                onClick={() => setAuthMode("none")}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  authMode === "none"
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface-3 hover:border-slate-500"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    authMode === "none" ? "border-accent" : "border-slate-500"
                  }`}>
                    {authMode === "none" && <div className="w-2 h-2 rounded-full bg-accent" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-100">No authentication</p>
                    <p className="text-xs text-slate-400 mt-0.5">Anyone on your network can access the dashboard.</p>
                  </div>
                </div>
              </button>
            </div>

            {/* No-auth warning */}
            {authMode === "none" && (
              <div className="mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
                <p className="text-xs text-yellow-300 leading-relaxed">
                  Only use this if Nestview is not accessible outside your local network, or if you're using an external auth proxy (e.g. Authelia, Authentik).
                </p>
                <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noAuthConfirmed}
                    onChange={(e) => setNoAuthConfirmed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-accent flex-shrink-0"
                  />
                  <span className="text-xs text-yellow-200">Confirm: disable authentication</span>
                </label>
              </div>
            )}
          </div>

          {/* Credentials — only shown for password auth */}
          {authMode === "password" && (
            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, username: true }))}
                  className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
                  placeholder="admin"
                  autoComplete="username"
                />
                {usernameError && <p className="mt-1.5 text-xs text-red-400">{usernameError}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                />
                {passwordError && <p className="mt-1.5 text-xs text-red-400">{passwordError}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
                  className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
                  placeholder="Repeat password"
                  autoComplete="new-password"
                />
                {confirmPasswordError && <p className="mt-1.5 text-xs text-red-400">{confirmPasswordError}</p>}
              </div>
            </div>
          )}

          {/* API error */}
          {apiError && (
            <p className="mb-4 text-xs text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2">
              {apiError}
            </p>
          )}

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending || !isValid}
            className="w-full py-2.5 px-4 rounded-lg bg-accent text-white text-sm font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
          >
            {mutation.isPending ? "Setting up…" : authMode === "none" ? "Continue to dashboard" : "Create account"}
          </button>
        </div>
      </div>
    </div>
  );
}
