import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ContainerLog } from "../types";

interface Props {
  dockerId: string;
}

function highlight(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-400/30 text-yellow-200 rounded-sm">{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}

function logLevel(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("error") || lower.includes("fatal") || lower.includes("critical")) return "text-red-400";
  if (lower.includes("warn")) return "text-yellow-400";
  if (lower.includes("info")) return "text-sky-400";
  if (lower.includes("debug") || lower.includes("trace")) return "text-slate-500";
  return "text-slate-300";
}

const LEGEND = [
  { color: "bg-red-400",    label: "ERROR" },
  { color: "bg-yellow-400", label: "WARN" },
  { color: "bg-sky-400",    label: "INFO" },
  { color: "bg-slate-500",  label: "DEBUG" },
] as const;

export default function LogViewer({ dockerId }: Props) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: logs = [], isLoading } = useQuery<ContainerLog[]>({
    queryKey: ["logs", dockerId, debouncedSearch],
    queryFn: () =>
      api.logs.forContainer(dockerId, {
        search: debouncedSearch || undefined,
        limit: 500,
      }),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  return (
    <div className="card flex flex-col h-[520px]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        <span className="text-sm font-medium text-slate-300">Logs</span>
        <div className="flex-1 relative min-w-[140px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              ✕
            </button>
          )}
        </div>

        {/* Severity legend */}
        <div className="flex items-center gap-2.5" aria-label="Log severity legend">
          {LEGEND.map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
              <span className="text-xs text-slate-600">{label}</span>
            </span>
          ))}
        </div>

        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`text-xs px-2 py-1 rounded border transition-colors shrink-0 ${
            autoScroll
              ? "border-accent text-accent"
              : "border-border text-slate-500 hover:border-slate-500"
          }`}
        >
          Auto-scroll
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-0.5">
        {isLoading && (
          <p className="text-slate-500 text-center py-8">Loading logs…</p>
        )}
        {!isLoading && logs.length === 0 && (
          <p className="text-slate-500 text-center py-8">
            {search ? "No logs match your search." : "No logs collected yet."}
          </p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3 hover:bg-surface-2 px-1 rounded group">
            <span className="text-slate-600 shrink-0 select-none">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className={`break-all ${logLevel(log.message)}`}>
              {highlight(log.message, debouncedSearch)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
