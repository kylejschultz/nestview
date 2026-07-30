import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiArrowUp,
  FiBox,
  FiChevronRight,
  FiExternalLink,
  FiFilter,
  FiRefreshCw,
  FiSearch,
} from "react-icons/fi";
import { Link } from "../router";
import { api } from "../api";
import StatusBadge from "../components/StatusBadge";
import Toast from "../components/Toast";
import { useToast } from "../hooks/useToast";
import type { Container } from "../types";
import { formatBytes, formatUptime } from "../utils";

type StatusFilter = "all" | "running" | "attention" | "updates" | "stopped";
type GroupFilter = "all" | "standalone" | string;
type SortKey = "state" | "name" | "cpu" | "memory" | "updates" | "uptime";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "attention", label: "Attention" },
  { key: "updates", label: "Updates" },
  { key: "stopped", label: "Stopped" },
];

const STATE_ORDER: Record<string, number> = {
  running: 0,
  restarting: 1,
  paused: 2,
  exited: 3,
  dead: 4,
  created: 5,
};

function memoryPercent(container: Container) {
  return container.mem_limit > 0 ? (container.mem_usage / container.mem_limit) * 100 : 0;
}

function normalizedDateValue(value: string | null) {
  if (!value) return 0;
  const normalized = /[Z+]/.test(value) ? value : value + "Z";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sourceLabel(container: Container) {
  if (!container.compose_project) return "Standalone";
  return container.compose_service
    ? `${container.compose_project} / ${container.compose_service}`
    : container.compose_project;
}

function portSummary(ports: string[]) {
  if (ports.length === 0) return "None";
  if (ports.length <= 2) return ports.join(", ");
  return `${ports.slice(0, 2).join(", ")} +${ports.length - 2}`;
}

function sortContainers(containers: Container[], sort: SortKey) {
  return [...containers].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "cpu") return b.cpu_percent - a.cpu_percent;
    if (sort === "memory") return memoryPercent(b) - memoryPercent(a);
    if (sort === "updates") return Number(b.update_available) - Number(a.update_available);
    if (sort === "uptime") return normalizedDateValue(a.started_at) - normalizedDateValue(b.started_at);

    const stateDelta = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
    return stateDelta || a.name.localeCompare(b.name);
  });
}

function ResourceBar({ value, tone = "accent" }: { value: number; tone?: "accent" | "emerald" | "amber" }) {
  const clamped = Math.max(0, Math.min(value, 100));
  const color = tone === "emerald" ? "bg-emerald-400" : tone === "amber" ? "bg-amber-400" : "bg-accent";

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StatTile({ label, value, subtext, tone = "default" }: { label: string; value: string | number; subtext: string; tone?: "default" | "good" | "warn" | "danger" }) {
  const valueColor = tone === "good"
    ? "text-emerald-300"
    : tone === "warn"
      ? "text-blue-300"
      : tone === "danger"
        ? "text-red-300"
        : "text-slate-100";

  return (
    <div className="rounded-lg border border-border bg-surface-1 px-4 py-3">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueColor}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{subtext}</p>
    </div>
  );
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-1 px-6 py-12 text-center">
      <FiBox className="mx-auto h-8 w-8 text-slate-600" />
      <p className="mt-3 text-sm font-medium text-slate-300">
        {search ? "No matching containers" : "No containers found"}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {search ? "Try a different search or filter." : "Collector data will appear here once containers are discovered."}
      </p>
    </div>
  );
}

function ContainerMobileRow({ container }: { container: Container }) {
  const memPct = memoryPercent(container);

  return (
    <Link
      to={`/containers/${container.docker_id}`}
      className="block rounded-lg border border-border bg-surface-1 p-4 transition-colors hover:border-accent/50 hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{container.name}</p>
          <p className="mt-1 truncate text-xs text-slate-500">{container.image}</p>
        </div>
        <StatusBadge state={container.state} className="shrink-0" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-500">CPU</p>
          <p className="mt-1 font-mono text-slate-200">{container.cpu_percent.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-slate-500">Memory</p>
          <p className="mt-1 font-mono text-slate-200">{memPct.toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-slate-500">Source</p>
          <p className="mt-1 truncate text-slate-200">{sourceLabel(container)}</p>
        </div>
        <div>
          <p className="text-slate-500">Ports</p>
          <p className="mt-1 truncate text-slate-200" title={container.ports.join(", ")}>{portSummary(container.ports)}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-slate-500">
        <span>{container.started_at && container.state === "running" ? `Up ${formatUptime(container.started_at)}` : container.status}</span>
        <span className="inline-flex items-center gap-1 text-accent">
          Detail
          <FiChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

function ContainerTable({ containers, checkingId, onCheckUpdates }: { containers: Container[]; checkingId: string | null; onCheckUpdates: (container: Container) => void }) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border bg-surface-1 lg:block">
      <div className="overflow-x-auto">
        <table className="min-w-[1120px] w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-2 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Container</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">CPU</th>
              <th className="px-4 py-3 font-medium">Memory</th>
              <th className="px-4 py-3 font-medium">Image</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Ports</th>
              <th className="px-4 py-3 font-medium">Uptime</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {containers.map((container) => {
              const memPct = memoryPercent(container);
              const isChecking = checkingId === container.docker_id;

              return (
                <tr key={container.docker_id} className="transition-colors hover:bg-surface-2/70">
                  <td className="px-4 py-3">
                    <div className="min-w-0">
                      <Link to={`/containers/${container.docker_id}`} className="font-medium text-slate-100 hover:text-accent">
                        {container.name}
                      </Link>
                      <p className="mt-1 font-mono text-xs text-slate-600">{container.short_id}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      <StatusBadge state={container.state} />
                      {container.update_available && (
                        <span className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-xs font-medium text-blue-300">
                          <FiArrowUp className="h-3 w-3" />
                          Update
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-24 space-y-1.5">
                      <p className="font-mono text-xs text-slate-200">{container.cpu_percent.toFixed(1)}%</p>
                      <ResourceBar value={container.cpu_percent} tone={container.cpu_percent > 75 ? "amber" : "accent"} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-32 space-y-1.5">
                      <p className="font-mono text-xs text-slate-200">
                        {container.mem_limit > 0
                          ? `${formatBytes(container.mem_usage)} / ${formatBytes(container.mem_limit)}`
                          : formatBytes(container.mem_usage)}
                      </p>
                      <ResourceBar value={memPct} tone={memPct > 80 ? "amber" : "emerald"} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="max-w-64 truncate font-mono text-xs text-slate-300" title={container.image}>{container.image}</p>
                    {container.image_size !== null && (
                      <p className="mt-1 text-xs text-slate-600">{formatBytes(container.image_size)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="max-w-44 truncate text-xs text-slate-300" title={sourceLabel(container)}>{sourceLabel(container)}</p>
                    {container.networks.length > 0 && (
                      <p className="mt-1 max-w-44 truncate text-xs text-slate-600" title={container.networks.join(", ")}>{container.networks.join(", ")}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="max-w-36 truncate text-xs text-slate-300" title={container.ports.join(", ")}>{portSummary(container.ports)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-slate-300">
                      {container.started_at && container.state === "running" ? formatUptime(container.started_at) : "-"}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">{container.restart_count} restart{container.restart_count === 1 ? "" : "s"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onCheckUpdates(container)}
                        disabled={isChecking}
                        aria-label={`Check ${container.name} for updates`}
                        title="Check for updates"
                        className="rounded-lg border border-border bg-surface-2 p-2 text-slate-400 transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-wait disabled:opacity-60"
                      >
                        <FiRefreshCw className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
                      </button>
                      <Link
                        to={`/containers/${container.docker_id}`}
                        aria-label={`Open ${container.name} detail`}
                        title="Open detail"
                        className="rounded-lg border border-border bg-surface-2 p-2 text-slate-400 transition-colors hover:border-accent/40 hover:text-accent"
                      >
                        <FiExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Containers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [sort, setSort] = useState<SortKey>("state");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const { toastState, showToast, dismissToast } = useToast();

  const { data: containers = [], isLoading, isError } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
    refetchInterval: 10_000,
  });

  const checkMutation = useMutation({
    mutationFn: (container: Container) => api.containers.checkForUpdates(container.docker_id),
    onMutate: (container) => setCheckingId(container.docker_id),
    onSuccess: (result) => {
      showToast(result.update_available ? "Update available" : "Container is current", "success");
      queryClient.invalidateQueries({ queryKey: ["containers"] });
    },
    onError: (err: Error) => showToast(err.message, "error"),
    onSettled: () => setCheckingId(null),
  });

  const groups = useMemo(() => {
    return Array.from(new Set(containers.map((container) => container.compose_project).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b));
  }, [containers]);

  const stats = useMemo(() => {
    const running = containers.filter((container) => container.state === "running").length;
    const updates = containers.filter((container) => container.update_available).length;
    const stopped = containers.filter((container) => container.state !== "running").length;
    const attention = containers.filter((container) => container.state !== "running" || container.update_available).length;
    const totalCpu = containers.filter((container) => container.state === "running").reduce((sum, container) => sum + container.cpu_percent, 0);
    const totalMemory = containers.reduce((sum, container) => sum + container.mem_usage, 0);

    return {
      running,
      attention,
      updates,
      stopped,
      avgCpu: running > 0 ? totalCpu / running : 0,
      totalMemory,
    };
  }, [containers]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchesSearch = (container: Container) => {
      if (!query) return true;
      return [
        container.name,
        container.image,
        container.state,
        container.status,
        container.compose_project ?? "",
        container.compose_service ?? "",
        container.short_id,
        ...container.ports,
        ...container.networks,
      ].some((value) => value.toLowerCase().includes(query));
    };

    return sortContainers(
      containers.filter((container) => {
        if (!matchesSearch(container)) return false;
        if (statusFilter === "running" && container.state !== "running") return false;
        if (statusFilter === "attention" && container.state === "running" && !container.update_available) return false;
        if (statusFilter === "updates" && !container.update_available) return false;
        if (statusFilter === "stopped" && container.state === "running") return false;
        if (groupFilter === "standalone" && container.compose_project) return false;
        if (groupFilter !== "all" && groupFilter !== "standalone" && container.compose_project !== groupFilter) return false;
        return true;
      }),
      sort
    );
  }, [containers, groupFilter, search, sort, statusFilter]);

  const filterCounts: Record<StatusFilter, number> = {
    all: containers.length,
    running: stats.running,
    attention: stats.attention,
    updates: stats.updates,
    stopped: stats.stopped,
  };

  return (
    <>
      {toastState && (
        <Toast
          key={toastState.id}
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismissToast}
        />
      )}
      <div className="space-y-5">
        <section className="grid gap-3 md:grid-cols-4">
          <StatTile label="Fleet" value={`${stats.running}/${containers.length}`} subtext="containers running" tone={stats.attention === 0 && containers.length > 0 ? "good" : "default"} />
          <StatTile label="Attention" value={stats.attention} subtext="stopped or update pending" tone={stats.attention > 0 ? "danger" : "good"} />
          <StatTile label="Updates" value={stats.updates} subtext="available image updates" tone={stats.updates > 0 ? "warn" : "default"} />
          <StatTile label="Resource Pulse" value={`${stats.avgCpu.toFixed(1)}%`} subtext={`${formatBytes(stats.totalMemory)} memory in use`} />
        </section>

        <section className="rounded-lg border border-border bg-surface-1 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative min-w-0 flex-1">
              <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, image, stack, port, network"
                className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-600 outline-none transition-colors focus:border-accent"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-border text-sm">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setStatusFilter(filter.key)}
                    className={`h-10 px-3 transition-colors ${
                      statusFilter === filter.key
                        ? "bg-accent text-white"
                        : "bg-surface-2 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {filter.label} {filterCounts[filter.key]}
                  </button>
                ))}
              </div>

              <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-slate-400">
                <FiFilter className="h-4 w-4 text-slate-600" />
                <select
                  value={groupFilter}
                  onChange={(event) => setGroupFilter(event.target.value)}
                  className="bg-transparent text-slate-300 outline-none"
                  aria-label="Filter by source"
                >
                  <option value="all">All sources</option>
                  <option value="standalone">Standalone</option>
                  {groups.map((group) => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
              </label>

              <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-slate-400">
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                  className="bg-transparent text-slate-300 outline-none"
                  aria-label="Sort containers"
                >
                  <option value="state">State</option>
                  <option value="name">Name</option>
                  <option value="cpu">CPU</option>
                  <option value="memory">Memory</option>
                  <option value="updates">Updates</option>
                  <option value="uptime">Uptime</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        {isLoading && (
          <div className="rounded-lg border border-border bg-surface-1 px-6 py-12 text-center text-sm text-slate-500">
            Connecting to collector...
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-6 py-12 text-center text-sm text-red-300">
            Unable to reach the Nestview backend.
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && <EmptyState search={search} />}

        {!isLoading && !isError && filtered.length > 0 && (
          <>
            <ContainerTable
              containers={filtered}
              checkingId={checkingId}
              onCheckUpdates={(container) => checkMutation.mutate(container)}
            />
            <div className="grid gap-3 lg:hidden">
              {filtered.map((container) => (
                <ContainerMobileRow key={container.docker_id} container={container} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
