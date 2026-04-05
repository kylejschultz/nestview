import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Container } from "../types";
import ContainerCard from "../components/ContainerCard";
import EventTimeline from "../components/EventTimeline";
import ConfirmModal from "../components/ConfirmModal";

type Filter = "all" | "running" | "stopped";

const STORAGE_KEY = "nestview:stack_collapsed";

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

type StackAction = "stop" | "start" | "restart" | "pull-restart";

function StackActionSpinner() {
  return (
    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

interface ComposeGroupProps {
  project: string;
  members: Container[];
}

function ComposeGroup({ project, members }: ComposeGroupProps) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<boolean>(() => !!loadCollapsed()[project]);
  const [pendingAction, setPendingAction] = useState<StackAction | null>(null);

  const { mutate, isPending, variables: activeAction } = useMutation<
    { ok: boolean; project: string; action: string; affected?: number; pulled?: number; restarted?: number },
    Error,
    StackAction
  >({
    mutationFn: (action: StackAction) => {
      if (action === "stop") return api.stacks.stop(project);
      if (action === "start") return api.stacks.start(project);
      if (action === "restart") return api.stacks.restart(project);
      return api.stacks.pullRestart(project);
    },
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["containers"] }), 1_500);
      setPendingAction(null);
    },
    onError: () => {
      setPendingAction(null);
    },
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        const all = loadCollapsed();
        if (next) {
          all[project] = true;
        } else {
          delete all[project];
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      } catch {}
      return next;
    });
  }

  const STACK_BUTTON_STYLES: Record<StackAction, string> = {
    stop:           "border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-400",
    start:          "border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-400",
    restart:        "border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 hover:border-yellow-400",
    "pull-restart": "border-blue-500/50 text-blue-400 hover:bg-blue-500/10 hover:border-blue-400",
  };

  const MODAL_MESSAGES: Record<StackAction, string> = {
    stop:           `Stop all containers in ${project}?`,
    start:          `Start all containers in ${project}?`,
    restart:        `Restart all containers in ${project}?`,
    "pull-restart": `Pull latest images and restart all containers in ${project}?`,
  };

  const updateCount = members.filter((m) => m.update_available).length;

  return (
    <section>
      {pendingAction && (
        <ConfirmModal
          message={MODAL_MESSAGES[pendingAction]}
          onConfirm={() => { mutate(pendingAction); }}
          onCancel={() => setPendingAction(null)}
        />
      )}

      <div className="w-full flex items-center gap-2 mb-3">
        {/* Collapse toggle — fills remaining space */}
        <button
          onClick={toggle}
          className="flex items-center gap-2 group cursor-pointer flex-1 min-w-0"
          aria-expanded={!collapsed}
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
          />
          <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 group-hover:text-slate-400 transition-colors truncate">
            {project}
          </span>
          {updateCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30 normal-case tracking-normal shrink-0">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              {updateCount === 1 ? "1 update" : `${updateCount} updates`}
            </span>
          )}
          {collapsed && (
            <span className="text-xs text-slate-600 font-normal normal-case tracking-normal shrink-0">
              — {members.length} container{members.length !== 1 ? "s" : ""}
            </span>
          )}
        </button>

        {/* Stack action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {(["restart", "stop", "start", "pull-restart"] as StackAction[]).map((action) => {
            const isActive = isPending && activeAction === action;
            const labels: Record<StackAction, string> = {
              stop: "Stop all",
              start: "Start all",
              restart: "Restart all",
              "pull-restart": "Pull & Restart",
            };
            return (
              <button
                key={action}
                disabled={isPending}
                onClick={() => setPendingAction(action)}
                title={labels[action]}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${STACK_BUTTON_STYLES[action]}`}
              >
                {isActive ? <StackActionSpinner /> : null}
                {labels[action]}
              </button>
            );
          })}
        </div>
      </div>

      {/* CSS grid-rows trick: animates height without JS measurement */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-1">
            {members.map((c) => (
              <ContainerCard key={c.docker_id} container={c} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const LIMIT_OPTIONS = [5, 10, 20];
const EVENT_LIMIT_KEY = "nestview.eventLimit";

export default function Dashboard() {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [eventLimit, setEventLimit] = useState<number>(() => {
    const stored = localStorage.getItem(EVENT_LIMIT_KEY);
    return stored ? Number(stored) : 5;
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerOpen]);

  const { data: containers = [], isLoading, isError } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
  });

  const filtered = containers
    .filter((c) => {
      if (filter === "running") return c.state === "running";
      if (filter === "stopped") return c.state !== "running";
      return true;
    })
    .filter(
      (c) =>
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.image.toLowerCase().includes(search.toLowerCase()) ||
        (c.compose_project ?? "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const order = { running: 0, restarting: 1, paused: 2, exited: 3, dead: 4, created: 5 };
      return (order[a.state as keyof typeof order] ?? 9) - (order[b.state as keyof typeof order] ?? 9);
    });

  const running = containers.filter((c) => c.state === "running").length;
  const stopped = containers.filter((c) => c.state !== "running").length;

  const groups: Record<string, Container[]> = {};
  const ungrouped: Container[] = [];
  for (const c of filtered) {
    if (c.compose_project) {
      (groups[c.compose_project] ??= []).push(c);
    } else {
      ungrouped.push(c);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-6">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search containers…"
            className="bg-surface-1 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent flex-1 min-w-[180px]"
          />
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {(["all", "running", "stopped"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 capitalize transition-colors ${
                  filter === f
                    ? "bg-accent text-white"
                    : "text-slate-400 hover:text-slate-200 hover:bg-surface-2"
                }`}
              >
                {f === "all" ? `All (${containers.length})` : f === "running" ? `Running (${running})` : `Stopped (${stopped})`}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <div className="text-center py-16 text-slate-500">Connecting to collector…</div>
        )}

        {isError && (
          <div className="card p-6 text-center text-red-400">
            Unable to reach the Nestview backend. Is it running?
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            {search ? "No containers match your search." : "No containers found. Is the collector running?"}
          </div>
        )}

        {/* Compose groups — each manages its own collapsed state + localStorage */}
        {Object.entries(groups).map(([project, members]) => (
          <ComposeGroup key={project} project={project} members={members} />
        ))}

        {/* Ungrouped containers */}
        {ungrouped.length > 0 && (
          <section>
            {Object.keys(groups).length > 0 && (
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Standalone</h2>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {ungrouped.map((c) => (
                <ContainerCard key={c.docker_id} container={c} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Sidebar — recent events */}
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Recent Events</h2>
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="text-slate-600 hover:text-slate-400 transition-colors"
              title="Configure event count"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {pickerOpen && (
              <div className="absolute right-0 top-6 z-20 bg-surface-2 border border-border rounded-lg shadow-xl p-2 flex flex-col gap-0.5 min-w-[100px]">
                <p className="text-xs text-slate-500 px-2 py-1">Show events</p>
                {LIMIT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setEventLimit(n);
                      localStorage.setItem(EVENT_LIMIT_KEY, String(n));
                      setPickerOpen(false);
                    }}
                    className={`text-left text-sm px-2 py-1.5 rounded-md transition-colors ${
                      eventLimit === n
                        ? "bg-accent/20 text-accent"
                        : "text-slate-300 hover:bg-surface-3"
                    }`}
                  >
                    {n} events
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <EventTimeline limit={eventLimit} />
      </aside>
    </div>
  );
}
