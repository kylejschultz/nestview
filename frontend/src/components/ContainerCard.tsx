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
        <StatusBadge state={c.state} className="shrink-0" />
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
      </div>
    </Link>
  );
}
