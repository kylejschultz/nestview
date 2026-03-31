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

export default function Header() {
  const location = useLocation();
  const { data } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
  });

  const total = data?.length ?? 0;
  const running = data?.filter((c) => c.state === "running").length ?? 0;

  return (
    <header className="border-b border-border bg-surface-1">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <svg
            className="w-6 h-6 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V11"
            />
          </svg>
          <span className="font-semibold text-slate-100 tracking-tight">Nestview</span>
        </Link>

        <div className="flex items-center gap-4">
          <StatusDot running={running} total={total} />

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
        </div>
      </div>
    </header>
  );
}
