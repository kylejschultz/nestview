import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiArrowRight,
  FiArrowUp,
  FiBox,
  FiCheck,
  FiChevronDown,
  FiChevronRight,
  FiExternalLink,
  FiFilter,
  FiLayers,
  FiRefreshCw,
  FiRotateCcw,
  FiSearch,
} from "react-icons/fi";
import { Link } from "../router";
import { api } from "../api";
import StatusBadge from "../components/StatusBadge";
import Toast from "../components/Toast";
import { useToast } from "../hooks/useToast";
import type { Container } from "../types";
import { formatBytes, formatUptime } from "../utils";

type ServicesMode = "compose" | "blank";
type ServiceStatusFilter = "all" | "running" | "attention" | "updates" | "stopped";
type ServiceSortKey = "health" | "name" | "cpu" | "memory" | "updates" | "containers";

interface ServiceGroup {
  id: string;
  name: string;
  source: "compose";
  members: Container[];
}

const SETUP_MODE_KEY = "nestview:services-setup-mode";
const SERVICE_STATUS_FILTERS: Array<{ key: ServiceStatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "attention", label: "Attention" },
  { key: "updates", label: "Updates" },
  { key: "stopped", label: "Stopped" },
];

const TONE_ORDER = { danger: 0, warn: 1, good: 2 };

function loadSetupMode(): ServicesMode | null {
  try {
    const stored = localStorage.getItem(SETUP_MODE_KEY);
    return stored === "compose" || stored === "blank" ? stored : null;
  } catch {
    return null;
  }
}

function saveSetupMode(mode: ServicesMode) {
  try {
    localStorage.setItem(SETUP_MODE_KEY, mode);
  } catch {
    // The page can still run with in-memory state if storage is unavailable.
  }
}

function clearSetupMode() {
  try {
    localStorage.removeItem(SETUP_MODE_KEY);
  } catch {
    // Ignore storage failures; the chooser can still reopen in-memory.
  }
}

function runningCount(containers: Container[]) {
  return containers.filter((container) => container.state === "running").length;
}

function memoryPercent(container: Container) {
  return container.mem_limit > 0 ? (container.mem_usage / container.mem_limit) * 100 : 0;
}

function serviceTone(service: ServiceGroup) {
  const updates = service.members.some((container) => container.update_available);
  const unhealthy = service.members.some((container) => container.state !== "running" || container.health_status === "unhealthy");
  if (unhealthy) return "danger";
  if (updates) return "warn";
  return "good";
}

function serviceHealth(service: ServiceGroup) {
  const healthChecks = service.members.filter((container) => container.health_status);
  if (healthChecks.length === 0) {
    return {
      label: "No health checks",
      className: "border-border bg-surface-2 text-slate-500",
    };
  }

  const unhealthy = healthChecks.filter((container) => container.health_status === "unhealthy").length;
  const starting = healthChecks.filter((container) => container.health_status === "starting").length;
  const healthy = healthChecks.filter((container) => container.health_status === "healthy").length;

  if (unhealthy > 0) {
    return {
      label: `${unhealthy} unhealthy`,
      className: "border-red-500/30 bg-red-500/10 text-red-300",
    };
  }

  if (starting > 0) {
    return {
      label: `${starting} starting`,
      className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
    };
  }

  if (healthy === healthChecks.length) {
    return {
      label: `${healthy} healthy`,
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    };
  }

  return {
    label: "Mixed health",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  };
}

function buildComposeServices(containers: Container[]): ServiceGroup[] {
  const groups = new Map<string, Container[]>();

  for (const container of containers) {
    if (!container.compose_project) continue;
    const members = groups.get(container.compose_project) ?? [];
    members.push(container);
    groups.set(container.compose_project, members);
  }

  return Array.from(groups.entries())
    .map(([project, members]) => ({
      id: project,
      name: project,
      source: "compose" as const,
      members: [...members].sort((a, b) => (a.compose_service ?? a.name).localeCompare(b.compose_service ?? b.name)),
    }))
    .sort((a, b) => {
      return TONE_ORDER[serviceTone(a)] - TONE_ORDER[serviceTone(b)] || a.name.localeCompare(b.name);
    });
}

function serviceMetrics(service: ServiceGroup) {
  const running = runningCount(service.members);
  const updates = service.members.filter((container) => container.update_available).length;
  const stopped = service.members.filter((container) => container.state !== "running").length;
  const unhealthy = service.members.filter((container) => container.health_status === "unhealthy").length;
  const starting = service.members.filter((container) => container.health_status === "starting").length;
  const restartCount = service.members.reduce((sum, container) => sum + container.restart_count, 0);
  const totalCpu = service.members
    .filter((container) => container.state === "running")
    .reduce((sum, container) => sum + container.cpu_percent, 0);
  const totalMemUsage = service.members.reduce((sum, container) => sum + container.mem_usage, 0);
  const totalMemLimit = service.members.reduce((sum, container) => sum + container.mem_limit, 0);
  const attention = updates + stopped + unhealthy + starting;

  return {
    attention,
    running,
    restartCount,
    starting,
    stopped,
    totalCpu,
    totalMemLimit,
    totalMemUsage,
    updates,
    unhealthy,
  };
}

function serviceResourceScore(service: ServiceGroup, metric: "cpu" | "memory") {
  const metrics = serviceMetrics(service);
  if (metric === "cpu") return metrics.totalCpu;
  return metrics.totalMemLimit > 0 ? (metrics.totalMemUsage / metrics.totalMemLimit) * 100 : metrics.totalMemUsage;
}

function sortServices(services: ServiceGroup[], sort: ServiceSortKey) {
  return [...services].sort((a, b) => {
    const aMetrics = serviceMetrics(a);
    const bMetrics = serviceMetrics(b);

    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "cpu") return serviceResourceScore(b, "cpu") - serviceResourceScore(a, "cpu") || a.name.localeCompare(b.name);
    if (sort === "memory") return serviceResourceScore(b, "memory") - serviceResourceScore(a, "memory") || a.name.localeCompare(b.name);
    if (sort === "updates") return bMetrics.updates - aMetrics.updates || a.name.localeCompare(b.name);
    if (sort === "containers") return b.members.length - a.members.length || a.name.localeCompare(b.name);

    return TONE_ORDER[serviceTone(a)] - TONE_ORDER[serviceTone(b)] || bMetrics.attention - aMetrics.attention || a.name.localeCompare(b.name);
  });
}

function serviceMatchesFilter(service: ServiceGroup, filter: ServiceStatusFilter) {
  const metrics = serviceMetrics(service);
  if (filter === "running") return metrics.running === service.members.length;
  if (filter === "attention") return metrics.attention > 0;
  if (filter === "updates") return metrics.updates > 0;
  if (filter === "stopped") return metrics.stopped > 0;
  return true;
}

function ResourceBar({ value, tone = "accent" }: { value: number; tone?: "accent" | "emerald" | "amber" | "red" }) {
  const clamped = Math.max(0, Math.min(value, 100));
  const color = tone === "emerald" ? "bg-emerald-400" : tone === "amber" ? "bg-amber-400" : tone === "red" ? "bg-red-400" : "bg-accent";

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StatTile({
  label,
  value,
  subtext,
  tone = "default",
}: {
  label: string;
  value: string | number;
  subtext: string;
  tone?: "default" | "good" | "warn" | "danger";
}) {
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

function NetworkUsage({ container }: { container: Container }) {
  const rx = container.net_rx_bytes ?? 0;
  const tx = container.net_tx_bytes ?? 0;
  if (rx <= 0 && tx <= 0) return <>No traffic</>;
  return <>{formatBytes(rx)} in / {formatBytes(tx)} out</>;
}

function ContainerMemberRow({ container }: { container: Container }) {
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const memPct = container.mem_limit > 0 ? Math.round(memoryPercent(container)) : null;

  return (
    <div className="rounded-lg border border-border bg-surface-2 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setResourcesOpen((open) => !open)}
          className="min-w-0 text-left"
          aria-expanded={resourcesOpen}
        >
          <span className="flex min-w-0 items-center gap-2">
            <FiChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-600 transition-transform ${resourcesOpen ? "rotate-180" : ""}`} />
            <span className="min-w-0 truncate font-medium text-slate-200">{container.compose_service ?? container.name}</span>
          </span>
          <span className="mt-0.5 block truncate pl-5 text-xs text-slate-600">
            {container.started_at && container.state === "running" ? formatUptime(container.started_at) : container.status}
          </span>
        </button>
        <span className="inline-flex items-center gap-2">
          {container.health_status && (
            <span className="rounded border border-border bg-surface-3 px-1.5 py-0.5 text-xs text-slate-400">
              {container.health_status}
            </span>
          )}
          {container.update_available && <span className="text-xs text-blue-300">Update</span>}
          <StatusBadge state={container.state} />
          <Link
            to={`/containers/${container.docker_id}`}
            className="rounded p-1 text-slate-600 transition-colors hover:bg-surface-3 hover:text-accent"
            aria-label={`Open ${container.name} details`}
            title="Open container details"
          >
            <FiChevronRight className="h-3.5 w-3.5" />
          </Link>
        </span>
      </div>

      {resourcesOpen && (
        <div className="grid gap-2 border-t border-border px-3 py-3 text-xs sm:grid-cols-3">
          <div>
            <p className="uppercase text-slate-600">CPU</p>
            <p className="mt-1 font-mono text-slate-200">{container.cpu_percent.toFixed(1)}%</p>
          </div>
          <div>
            <p className="uppercase text-slate-600">Memory</p>
            <p className="mt-1 font-mono text-slate-200">
              {memPct !== null ? `${memPct}%` : formatBytes(container.mem_usage)}
            </p>
            <p className="mt-0.5 truncate text-slate-600">
              {container.mem_limit > 0 ? `${formatBytes(container.mem_usage)} / ${formatBytes(container.mem_limit)}` : "limit unknown"}
            </p>
          </div>
          <div>
            <p className="uppercase text-slate-600">Network</p>
            <p className="mt-1 truncate font-mono text-slate-200">
              <NetworkUsage container={container} />
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function SetupChoice({
  composeCount,
  standaloneCount,
  onChoose,
}: {
  composeCount: number;
  standaloneCount: number;
  onChoose: (mode: ServicesMode) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-1">
      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-center">
        <div className="min-w-0">
          <p className="text-xs uppercase text-slate-500">Services setup</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-100">Choose a starting point</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Services are the operator-facing layer above containers. Start from Compose stacks for an instant layout, or keep the page blank until manual service groups are ready.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <button
            type="button"
            onClick={() => onChoose("compose")}
            className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-left transition-colors hover:border-accent hover:bg-accent/15"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-100">
              <FiLayers className="h-4 w-4 text-accent" />
              Start with Compose stacks
            </span>
            <span className="mt-2 block text-xs leading-5 text-slate-400">
              Seed {composeCount} service{composeCount === 1 ? "" : "s"} from Docker Compose labels.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onChoose("blank")}
            className="rounded-lg border border-border bg-surface-2 p-4 text-left transition-colors hover:border-slate-500 hover:bg-surface-3"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-100">
              <FiBox className="h-4 w-4 text-slate-400" />
              Start blank
            </span>
            <span className="mt-2 block text-xs leading-5 text-slate-400">
              Leave {standaloneCount} standalone container{standaloneCount === 1 ? "" : "s"} unassigned for now.
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

function ServiceCard({
  service,
  isExpanded,
  isChecking,
  onToggle,
  onCheckUpdates,
}: {
  service: ServiceGroup;
  isExpanded: boolean;
  isChecking: boolean;
  onToggle: () => void;
  onCheckUpdates: (service: ServiceGroup) => void;
}) {
  const metrics = serviceMetrics(service);
  const tone = serviceTone(service);
  const health = serviceHealth(service);
  const dotColor = tone === "danger" ? "bg-red-400" : tone === "warn" ? "bg-blue-300" : "bg-emerald-400";
  const memPct = metrics.totalMemLimit > 0 ? Math.round((metrics.totalMemUsage / metrics.totalMemLimit) * 100) : null;

  return (
    <article className="rounded-lg border border-border bg-surface-1">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
              <h3 className="truncate text-base font-semibold text-slate-100">{service.name}</h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Compose stack · {metrics.running}/{service.members.length} running</span>
              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 ${health.className}`}>
                {health.label}
              </span>
              {metrics.updates > 0 && (
                <span className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-blue-300">
                  <FiArrowUp className="h-3 w-3" />
                  {metrics.updates} update{metrics.updates === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onCheckUpdates(service)}
            disabled={isChecking}
            className="shrink-0 rounded-lg border border-border bg-surface-2 p-2 text-slate-400 transition-colors hover:border-blue-400/40 hover:text-blue-300 disabled:cursor-wait disabled:opacity-60"
            aria-label={`Check ${service.name} for updates`}
            title="Check stack updates"
          >
            <FiRefreshCw className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase text-slate-600">CPU</p>
          <p className="mt-1 font-mono text-sm text-slate-200">{metrics.totalCpu.toFixed(1)}%</p>
          <div className="mt-2">
            <ResourceBar value={metrics.totalCpu} tone={metrics.totalCpu > 75 ? "amber" : "accent"} />
          </div>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-600">Memory</p>
          <p className="mt-1 font-mono text-sm text-slate-200">
            {memPct !== null ? `${memPct}%` : formatBytes(metrics.totalMemUsage)}
          </p>
          <p className="mt-1 truncate text-xs text-slate-600">
            {metrics.totalMemLimit > 0 ? `${formatBytes(metrics.totalMemUsage)} / ${formatBytes(metrics.totalMemLimit)}` : "limit unknown"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-600">Attention</p>
          <p className={`mt-1 font-mono text-sm ${metrics.attention > 0 ? "text-blue-300" : "text-slate-200"}`}>
            {metrics.attention}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {metrics.restartCount} restart{metrics.restartCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 text-left text-sm text-slate-300 transition-colors hover:text-slate-100"
          aria-expanded={isExpanded}
        >
          <span className="font-medium">Containers</span>
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            {service.members.length} member{service.members.length === 1 ? "" : "s"}
            <FiChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </span>
        </button>

        {isExpanded && (
          <div className="mt-3 space-y-1.5">
            {service.members.map((container) => (
              <ContainerMemberRow key={container.docker_id} container={container} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function ServiceTable({
  services,
  checkingProject,
  onCheckUpdates,
}: {
  services: ServiceGroup[];
  checkingProject: string | null;
  onCheckUpdates: (service: ServiceGroup) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpanded(serviceId: string) {
    setExpandedId((current) => (current === serviceId ? null : serviceId));
  }

  return (
    <div className="hidden overflow-hidden rounded-lg border border-border bg-surface-1 lg:block">
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[27%]" />
          <col className="w-[17%]" />
          <col className="w-[24%]" />
          <col className="w-[18%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead className="border-b border-border bg-surface-2 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Service</th>
            <th className="px-4 py-3 font-medium">Health</th>
            <th className="px-4 py-3 font-medium">Resources</th>
            <th className="px-4 py-3 font-medium">Containers</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {services.map((service) => {
            const metrics = serviceMetrics(service);
            const health = serviceHealth(service);
            const isExpanded = expandedId === service.id;
            const isChecking = checkingProject === service.id;
            const memPct = metrics.totalMemLimit > 0 ? (metrics.totalMemUsage / metrics.totalMemLimit) * 100 : 0;

            return (
              <Fragment key={service.id}>
                <tr
                  className="cursor-pointer transition-colors hover:bg-surface-2/70"
                  onClick={() => toggleExpanded(service.id)}
                  tabIndex={0}
                  role="button"
                  aria-expanded={isExpanded}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleExpanded(service.id);
                    }
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpanded(service.id);
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${service.name}`}
                        title={isExpanded ? "Collapse row" : "Expand row"}
                        className="shrink-0 rounded-md border border-border bg-surface-2 p-1 text-slate-500 transition-colors hover:border-accent/40 hover:text-accent"
                      >
                        <FiChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-100">{service.name}</p>
                        <p className="mt-1 truncate text-xs text-slate-600">Compose stack</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${health.className}`}>
                        {health.label}
                      </span>
                      <span className="text-xs text-slate-500">
                        {metrics.running}/{service.members.length} running
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-2">
                      <div className="grid grid-cols-[2rem_3.5rem_minmax(0,1fr)] items-center gap-2">
                        <span className="text-[0.65rem] uppercase text-slate-600">CPU</span>
                        <span className="font-mono text-xs text-slate-200">{metrics.totalCpu.toFixed(1)}%</span>
                        <ResourceBar value={metrics.totalCpu} tone={metrics.totalCpu > 75 ? "amber" : "accent"} />
                      </div>
                      <div className="grid grid-cols-[2rem_3.5rem_minmax(0,1fr)] items-center gap-2">
                        <span className="text-[0.65rem] uppercase text-slate-600">RAM</span>
                        <span className="font-mono text-xs text-slate-200">{memPct.toFixed(0)}%</span>
                        <ResourceBar value={memPct} tone={memPct > 80 ? "amber" : "emerald"} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-slate-300">{service.members.length} member{service.members.length === 1 ? "" : "s"}</p>
                    <p className={`mt-1 text-xs ${metrics.attention > 0 ? "text-blue-300" : "text-slate-600"}`}>
                      {metrics.attention} attention
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCheckUpdates(service);
                        }}
                        disabled={isChecking}
                        aria-label={`Check ${service.name} for updates`}
                        title="Check stack updates"
                        className="rounded-lg border border-border bg-surface-2 p-2 text-slate-400 transition-colors hover:border-blue-400/40 hover:text-blue-300 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isChecking ? <FiRefreshCw className="h-4 w-4 animate-spin" /> : <FiArrowUp className="h-4 w-4" />}
                      </button>
                      <Link
                        to={`/containers/${service.members[0]?.docker_id ?? ""}`}
                        aria-label={`Open ${service.name} first container`}
                        title="Open first container"
                        onClick={(event) => event.stopPropagation()}
                        className="rounded-lg border border-border bg-surface-2 p-2 text-slate-400 transition-colors hover:border-accent/40 hover:text-accent"
                      >
                        <FiExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-surface-0/45">
                    <td colSpan={5} className="px-5 pb-5 pt-3">
                      <div className="space-y-1.5">
                        {service.members.map((container) => (
                          <ContainerMemberRow key={container.docker_id} container={container} />
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BlankState({ composeCount, onUseCompose }: { composeCount: number; onUseCompose: () => void }) {
  return (
    <section className="rounded-lg border border-dashed border-border bg-surface-1 px-6 py-12 text-center">
      <FiLayers className="mx-auto h-8 w-8 text-slate-600" />
      <h2 className="mt-3 text-base font-semibold text-slate-100">No services yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        Manual service groups are next. For now, you can switch back to Compose-derived services whenever you want.
      </p>
      {composeCount > 0 && (
        <button
          type="button"
          onClick={onUseCompose}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent transition-colors hover:border-accent hover:bg-accent/15"
        >
          <FiLayers className="h-4 w-4" />
          Use {composeCount} Compose service{composeCount === 1 ? "" : "s"}
        </button>
      )}
    </section>
  );
}

export default function Services() {
  const queryClient = useQueryClient();
  const [setupMode, setSetupMode] = useState<ServicesMode | null>(loadSetupMode);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ServiceStatusFilter>("all");
  const [sort, setSort] = useState<ServiceSortKey>("health");
  const [expandedMobileServiceId, setExpandedMobileServiceId] = useState<string | null>(null);
  const [checkingProject, setCheckingProject] = useState<string | null>(null);
  const { toastState, showToast, dismissToast } = useToast();

  const { data: containers = [], isLoading, isError } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
    refetchInterval: 10_000,
  });

  const checkUpdatesMutation = useMutation({
    mutationFn: (service: ServiceGroup) => api.stacks.checkForUpdates(service.id),
    onMutate: (service) => {
      setCheckingProject(service.id);
    },
    onSuccess: (result) => {
      showToast(`Checked ${result.checked} container${result.checked === 1 ? "" : "s"}`, "success");
      queryClient.invalidateQueries({ queryKey: ["containers"] });
    },
    onError: (error: Error) => {
      showToast(error.message, "error");
    },
    onSettled: () => {
      setCheckingProject(null);
    },
  });

  const composeServices = useMemo(() => buildComposeServices(containers), [containers]);
  const standalone = useMemo(() => containers.filter((container) => !container.compose_project), [containers]);
  const visibleServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesSearch = (service: ServiceGroup) => {
      if (!q) return true;
      return [
        service.name,
        ...service.members.flatMap((container) => [
          container.name,
          container.compose_service ?? "",
          container.image,
          container.state,
          container.status,
          container.health_status ?? "",
          ...container.ports,
          ...container.networks,
        ]),
      ].some((value) => value.toLowerCase().includes(q));
    };

    return sortServices(
      composeServices.filter((service) => matchesSearch(service) && serviceMatchesFilter(service, statusFilter)),
      sort
    );
  }, [composeServices, search, sort, statusFilter]);

  const runningServices = composeServices.filter((service) => runningCount(service.members) === service.members.length).length;
  const serviceStats = useMemo(() => {
    const servicesWithAttention = composeServices.filter((service) => serviceMetrics(service).attention > 0).length;
    const servicesWithUpdates = composeServices.filter((service) => serviceMetrics(service).updates > 0).length;
    const servicesWithStopped = composeServices.filter((service) => serviceMetrics(service).stopped > 0).length;
    const totalCpu = composeServices.reduce((sum, service) => sum + serviceMetrics(service).totalCpu, 0);
    const totalMemory = composeServices.reduce((sum, service) => sum + serviceMetrics(service).totalMemUsage, 0);
    const runningContainers = containers.filter((container) => container.state === "running").length;

    return {
      avgCpu: runningContainers > 0 ? totalCpu / runningContainers : 0,
      servicesWithAttention,
      servicesWithStopped,
      servicesWithUpdates,
      totalMemory,
      updates: containers.filter((container) => container.update_available).length,
    };
  }, [composeServices, containers]);

  const filterCounts: Record<ServiceStatusFilter, number> = {
    all: composeServices.length,
    running: runningServices,
    attention: serviceStats.servicesWithAttention,
    updates: serviceStats.servicesWithUpdates,
    stopped: serviceStats.servicesWithStopped,
  };

  function chooseMode(mode: ServicesMode) {
    saveSetupMode(mode);
    setSetupMode(mode);
  }

  if (isLoading) {
    return <div className="py-16 text-center text-slate-500">Loading services...</div>;
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
        Unable to load services from container data.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface-1 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase text-slate-500">Services</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-100">Service groups</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Operator-facing groups built from the containers Nestview already tracks.
            </p>
          </div>
          {setupMode && (
            <button
              type="button"
              onClick={() => {
                clearSetupMode();
                setSetupMode(null);
              }}
              className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
            >
              <FiRotateCcw className="h-4 w-4" />
              Re-run setup
            </button>
          )}
        </div>
      </section>

      {!setupMode ? (
        <SetupChoice
          composeCount={composeServices.length}
          standaloneCount={standalone.length}
          onChoose={chooseMode}
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Services"
              value={setupMode === "compose" ? `${runningServices}/${composeServices.length}` : 0}
              subtext={setupMode === "compose" ? "fully running services" : "manual groups pending"}
              tone={runningServices === composeServices.length && composeServices.length > 0 ? "good" : "default"}
            />
            <StatTile
              label="Attention"
              value={setupMode === "compose" ? serviceStats.servicesWithAttention : 0}
              subtext="stopped, starting, unhealthy, or update pending"
              tone={serviceStats.servicesWithAttention > 0 ? "danger" : "good"}
            />
            <StatTile
              label="Updates"
              value={serviceStats.updates}
              subtext="available image updates"
              tone={serviceStats.updates > 0 ? "warn" : "default"}
            />
            <StatTile
              label="Resource Pulse"
              value={`${serviceStats.avgCpu.toFixed(1)}%`}
              subtext={`${formatBytes(serviceStats.totalMemory)} memory in use`}
            />
          </section>

          {setupMode === "blank" ? (
            <BlankState composeCount={composeServices.length} onUseCompose={() => chooseMode("compose")} />
          ) : (
            <>
              <section className="rounded-lg border border-border bg-surface-1 p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="relative min-w-0 flex-1">
                    <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search service, container, image, port, network"
                      className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-600 outline-none transition-colors focus:border-accent"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex overflow-hidden rounded-lg border border-border text-sm">
                      {SERVICE_STATUS_FILTERS.map((filter) => (
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
                        value={sort}
                        onChange={(event) => setSort(event.target.value as ServiceSortKey)}
                        className="bg-transparent text-slate-300 outline-none"
                        aria-label="Sort services"
                      >
                        <option value="health">Health</option>
                        <option value="name">Name</option>
                        <option value="cpu">CPU</option>
                        <option value="memory">Memory</option>
                        <option value="updates">Updates</option>
                        <option value="containers">Containers</option>
                      </select>
                    </label>
                    <span className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-sm text-slate-400">
                      <FiCheck className="h-3.5 w-3.5 text-emerald-400" />
                      Compose seeded
                    </span>
                    <Link
                      to="/containers"
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-sm text-slate-400 transition-colors hover:border-accent/40 hover:text-accent"
                    >
                      Containers
                      <FiArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </section>

              {visibleServices.length > 0 ? (
                <>
                  <ServiceTable
                    services={visibleServices}
                    checkingProject={checkingProject}
                    onCheckUpdates={(service) => checkUpdatesMutation.mutate(service)}
                  />
                  <section className="grid gap-4 lg:hidden">
                    {visibleServices.map((service) => (
                      <ServiceCard
                        key={service.id}
                        service={service}
                        isExpanded={expandedMobileServiceId === service.id}
                        isChecking={checkingProject === service.id}
                        onToggle={() => setExpandedMobileServiceId((current) => (current === service.id ? null : service.id))}
                        onCheckUpdates={(service) => checkUpdatesMutation.mutate(service)}
                      />
                    ))}
                  </section>
                </>
              ) : (
                <section className="rounded-lg border border-dashed border-border bg-surface-1 px-6 py-12 text-center">
                  <FiSearch className="mx-auto h-8 w-8 text-slate-600" />
                  <p className="mt-3 text-sm font-medium text-slate-300">No matching services</p>
                  <p className="mt-1 text-sm text-slate-500">Try a different service, container, image, or filter.</p>
                </section>
              )}
            </>
          )}
        </>
      )}

      {toastState && <Toast message={toastState.message} type={toastState.type} onDismiss={dismissToast} />}
    </div>
  );
}
