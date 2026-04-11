import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiError, setApiError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.auth.login({ username, password }),
    onSuccess: () => {
      onLogin();
    },
    onError: (err: Error) => {
      if (err.message.includes("401") || err.message.toLowerCase().includes("invalid")) {
        setApiError("Invalid username or password.");
      } else {
        setApiError(err.message);
      }
    },
  });

  function handleSubmit() {
    if (mutation.isPending) return;
    setApiError(null);
    mutation.mutate();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSubmit();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-1 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <svg viewBox="0 0 580 120" xmlns="http://www.w3.org/2000/svg" height="32" style={{ display: "block" }}>
            <g transform="translate(60, 60) scale(0.43)">
              <g fill="none">
                <circle cx="0" cy="0" r="158" stroke="#252a3a" strokeWidth="20" />
                <circle cx="0" cy="0" r="118" stroke="#2e3347" strokeWidth="18" />
                <circle cx="0" cy="0" r="82"  stroke="#4b4f6e" strokeWidth="14" />
                <circle cx="0" cy="0" r="50"  stroke="#6366f1" strokeWidth="12" />
              </g>
              <circle cx="0" cy="0" r="22" fill="#6366f1" />
            </g>
            <text y="84" fontFamily="Helvetica Neue,Helvetica,Arial,sans-serif" fontSize="76" letterSpacing="-2">
              <tspan x="140" fontWeight="300" fill="#e2e8f0">nest</tspan>
              <tspan fontWeight="700" fill="#6366f1">view</tspan>
            </text>
          </svg>
        </div>

        {/* Card */}
        <div className="bg-surface-2 border border-border rounded-xl p-8">
          <h1 className="text-xl font-semibold text-slate-100 mb-1">Sign in</h1>
          <p className="text-sm text-slate-400 mb-6">Enter your credentials to access the dashboard.</p>

          {/* Username */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
              autoComplete="username"
              autoFocus
            />
          </div>

          {/* Password */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
              autoComplete="current-password"
            />
          </div>

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
            disabled={mutation.isPending}
            className="w-full py-2.5 px-4 rounded-lg bg-accent text-white text-sm font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
          >
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
