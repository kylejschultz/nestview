import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import NestviewLogo from "../components/NestviewLogo";

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
          <NestviewLogo />
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
