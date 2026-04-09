import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
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
  const { data } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
  });
  const { data: versionData } = useQuery({
    queryKey: ["version"],
    queryFn: api.version,
    staleTime: Infinity,
    retry: false,
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
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
              v{versionData.version}
            </span>
          )}

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
