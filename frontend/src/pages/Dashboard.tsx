import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { Container } from "../types";
import ContainerCard from "../components/ContainerCard";
import EventTimeline from "../components/EventTimeline";

type Filter = "all" | "running" | "stopped";

export default function Dashboard() {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

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

        {/* Compose groups */}
        {Object.entries(groups).map(([project, members]) => (
          <section key={project}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              {project}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {members.map((c) => (
                <ContainerCard key={c.docker_id} container={c} />
              ))}
            </div>
          </section>
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
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Recent Events</h2>
        <EventTimeline />
      </aside>
    </div>
  );
}
