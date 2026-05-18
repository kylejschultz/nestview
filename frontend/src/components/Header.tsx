import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { Container } from "../types";

function StatusDot({ running, total }: { running: number; total: number }) {
  const allGood = running === total && total > 0;
  const someBad = running < total;
  const color = allGood ? "bg-green-500" : someBad ? "bg-red-500" : "bg-slate-500";
  return (
    <span className="flex items-center gap-2 text-sm text-slate-400">
      <span className={`w-2 h-2 rounded-full ${color} animate-pulse`} />
      {running}/{total} running
    </span>
  );
}

interface HeaderProps {
  onLogout?: () => void;
  authMode?: string;
}

export default function Header({ onLogout, authMode }: HeaderProps) {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { data } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
    refetchInterval: 10_000,
    enabled: isAuthenticated,
  });
  const { data: versionData } = useQuery({
    queryKey: ["version"],
    queryFn: api.version,
    staleTime: Infinity,
    retry: false,
    enabled: isAuthenticated,
  });

  const total = data?.length ?? 0;
  const running = data?.filter((c) => c.state === "running").length ?? 0;

  return (
    <header className="border-b border-border bg-surface-1">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <svg viewBox="0 0 580 120" xmlns="http://www.w3.org/2000/svg" height="28" style={{ display: 'block' }}>
            <g transform="translate(60, 60) scale(0.43)">
              <g fill="none">
                <circle cx="0" cy="0" r="158" stroke="#252a3a" strokeWidth="20"/>
                <circle cx="0" cy="0" r="118" stroke="#2e3347" strokeWidth="18"/>
                <circle cx="0" cy="0" r="82"  stroke="#4b4f6e" strokeWidth="14"/>
                <circle cx="0" cy="0" r="50"  stroke="#6366f1" strokeWidth="12"/>
              </g>
              <circle cx="0" cy="0" r="22" fill="#6366f1"/>
            </g>
            <text y="84" fontFamily="Helvetica Neue,Helvetica,Arial,sans-serif" fontSize="76" letterSpacing="-2">
              <tspan x="140" fontWeight="300" fill="#e2e8f0">nest</tspan>
              <tspan fontWeight="700" fill="#6366f1">view</tspan>
            </text>
          </svg>
        </Link>

        <div className="flex items-center gap-4">
          <StatusDot running={running} total={total} />
          {versionData && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30"
              title={versionData.build_sha ? `SHA: ${versionData.build_sha}` : undefined}
            >
              v{versionData.version}
            </span>
          )}

          <a
            href="https://discord.gg/aDEBQq3XtN"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join the Nestview Discord"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-2 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.036.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .036-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          </a>

          <Link
            to="/settings"
            aria-label="Settings"
            className={`p-1.5 rounded-lg transition-colors ${
              location.pathname === "/settings"
                ? "text-accent bg-accent/10"
                : "text-slate-500 hover:text-slate-300 hover:bg-surface-2"
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>

          {authMode === "password" && onLogout && (
            <button
              onClick={onLogout}
              aria-label="Sign out"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-2 transition-colors"
              title="Sign out"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
