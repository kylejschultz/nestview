import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ContainerLog } from "../types";
import { formatDateTime } from "../utils";
import { useTimezone } from "../TimezoneContext";

interface Props {
  dockerId: string;
}

type LogLevel = "error" | "warn" | "info" | "debug" | "default";

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

function logLevel(msg: string): LogLevel {
  const lower = msg.toLowerCase();
  if (lower.includes("error") || lower.includes("fatal") || lower.includes("critical")) return "error";
  if (lower.includes("warn")) return "warn";
  if (lower.includes("info")) return "info";
  if (lower.includes("debug") || lower.includes("trace")) return "debug";
  return "default";
}

const LEVEL_ROW_CLASSES: Record<LogLevel, string> = {
  error:   "bg-red-950/40 border-l-2 border-red-500",
  warn:    "bg-yellow-950/40 border-l-2 border-yellow-500",
  info:    "bg-sky-950/30 border-l-2 border-sky-500",
  debug:   "bg-slate-800/30 border-l-2 border-slate-600",
  default: "",
};

const LEVEL_TEXT_CLASSES: Record<LogLevel, string> = {
  error:   "text-red-400",
  warn:    "text-yellow-400",
  info:    "text-sky-400",
  debug:   "text-slate-500",
  default: "text-slate-300",
};

type FilterLevel = "ALL" | "ERROR" | "WARN" | "INFO" | "DEBUG";

const FILTER_BUTTONS: { label: FilterLevel; level: LogLevel | null; activeClasses: string }[] = [
  { label: "ALL",   level: null,    activeClasses: "border-slate-400 text-slate-200 bg-slate-700/50" },
  { label: "ERROR", level: "error", activeClasses: "border-red-500 text-red-400 bg-red-950/50" },
  { label: "WARN",  level: "warn",  activeClasses: "border-yellow-500 text-yellow-400 bg-yellow-950/50" },
  { label: "INFO",  level: "info",  activeClasses: "border-sky-500 text-sky-400 bg-sky-950/50" },
  { label: "DEBUG", level: "debug", activeClasses: "border-slate-500 text-slate-400 bg-slate-800/50" },
];

export default function LogViewer({ dockerId }: Props) {
  const tz = useTimezone();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [autoScroll, setAutoScroll] = useState(false);
  const [levelFilter, setLevelFilter] = useState<FilterLevel>("ALL");
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

  const visibleLogs = (levelFilter === "ALL"
    ? logs
    : logs.filter((log) => logLevel(log.message) === levelFilter.toLowerCase())
  ).slice().sort((a, b) => {
    const cmp = a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
    return sortOrder === "desc" ? -cmp : cmp;
  });

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

        {/* Level filter buttons */}
        <div className="flex items-center gap-1.5">
          {FILTER_BUTTONS.map(({ label, activeClasses }) => (
            <button
              key={label}
              onClick={() => setLevelFilter(label)}
              className={`text-xs px-2 py-1 rounded border transition-colors shrink-0 ${
                levelFilter === label
                  ? activeClasses
                  : "border-border text-slate-600 hover:border-slate-500 hover:text-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            const next = sortOrder === "desc" ? "asc" : "desc";
            setSortOrder(next);
            setAutoScroll(next === "asc");
          }}
          className="text-xs px-2 py-1 rounded border border-border text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors shrink-0"
        >
          {sortOrder === "desc" ? "↓ Newest first" : "↑ Oldest first"}
        </button>

        {sortOrder === "asc" && (
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
        )}

        <div className="flex items-center gap-1 ml-auto shrink-0">
          <span className="text-xs text-slate-600 mr-1">Export:</span>
          <button
            // Not an open redirect: the URL is a hardcoded same-origin path (/api/logs/export);
            // dockerId is an API-supplied container ID, not a user-controlled redirect target.
            onClick={() => { window.location.href = `/api/logs/export?container_id=${encodeURIComponent(dockerId)}&format=txt`; }}
            className="text-xs px-2 py-1 rounded border border-border text-slate-500 hover:border-slate-400 hover:text-slate-300 transition-colors"
          >
            .txt
          </button>
          <button
            // Not an open redirect: same as above — hardcoded same-origin path, fixed format value.
            onClick={() => { window.location.href = `/api/logs/export?container_id=${encodeURIComponent(dockerId)}&format=csv`; }}
            className="text-xs px-2 py-1 rounded border border-border text-slate-500 hover:border-slate-400 hover:text-slate-300 transition-colors"
          >
            .csv
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-0.5">
        {isLoading && (
          <p className="text-slate-500 text-center py-8">Loading logs…</p>
        )}
        {!isLoading && visibleLogs.length === 0 && (
          <p className="text-slate-500 text-center py-8">
            {search || levelFilter !== "ALL" ? "No logs match your filter." : "No logs collected yet."}
          </p>
        )}
        {visibleLogs.map((log) => {
          const level = logLevel(log.message);
          return (
            <div
              key={log.id}
              className={`flex gap-3 hover:brightness-125 px-1 rounded group ${LEVEL_ROW_CLASSES[level]}`}
            >
              <span className="text-slate-600 shrink-0 select-none">
                {formatDateTime(log.timestamp, tz)}
              </span>
              <span className={`break-all ${LEVEL_TEXT_CLASSES[level]}`}>
                {highlight(log.message, debouncedSearch)}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
