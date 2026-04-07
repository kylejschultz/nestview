import { Link } from "react-router-dom";
import type { Container } from "../types";
import StatusBadge from "./StatusBadge";
import MetricBar from "./MetricBar";
import { formatBytes, formatUptime } from "../utils";

interface Props {
  container: Container;
}

export default function ContainerCard({ container: c }: Props) {
  const memPct = c.mem_limit > 0 ? (c.mem_usage / c.mem_limit) * 100 : 0;

  return (
    <Link
      to={`/containers/${c.docker_id}`}
      className="card p-4 flex flex-col gap-3 hover:border-accent/50 hover:bg-surface-2 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-100 truncate">{c.name}</p>
          <p className="text-xs text-slate-500 font-mono truncate mt-0.5">{c.image}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {c.update_available && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              Update
            </span>
          )}
          <StatusBadge state={c.state} />
        </div>
      </div>

      {c.state === "running" && (
        <div className="space-y-2">
          <MetricBar label="CPU" value={c.cpu_percent} display={`${c.cpu_percent.toFixed(1)}%`} />
          <MetricBar
            label="Memory"
            value={memPct}
            display={
              c.mem_limit > 0
                ? `${formatBytes(c.mem_usage)} / ${formatBytes(c.mem_limit)}`
                : formatBytes(c.mem_usage)
            }
          />
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
        {c.started_at && c.state === "running" && (
          <span>Up {formatUptime(c.started_at)}</span>
        )}
        {c.restart_count > 0 && (
          <span className="text-yellow-500">{c.restart_count} restarts</span>
        )}
        {c.compose_project && (
          <span className="badge bg-surface-3 text-slate-400 border border-border">
            {c.compose_project}
          </span>
        )}
        {c.ports.length > 0 && (
          <span
            className="flex items-center gap-1 text-slate-500"
            title={c.ports.join(", ")}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
            <span className="text-xs">{c.ports.length}</span>
          </span>
        )}
      </div>
    </Link>
  );
}
