import { Link } from "react-router-dom";
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
        <StatusDot running={running} total={total} />
      </div>
    </header>
  );
}
