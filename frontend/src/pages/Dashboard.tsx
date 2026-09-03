import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiAlertTriangle, FiArrowRight, FiArrowUp, FiBox, FiLayers, FiZap } from "react-icons/fi";
import { Link } from "../router";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import AnalyticsBanner from "../components/AnalyticsBanner";
import type { Container, ContainerEvent } from "../types";
import { formatBytes, formatDateTime } from "../utils";
import { useTimezone } from "../TimezoneContext";

function isUnhealthy(container: Container) {
  return container.state === "running" && container.health_status === "unhealthy";
}

function hasRepeatedRestart(container: Container) {
  return container.state === "restarting" && container.restart_count > 1;
}

function hasStoppedContainerProblem(container: Container) {
  if (container.state === "running") return false;
  return (
    container.state === "dead" ||
    container.oom_killed ||
    (container.exit_code !== null && ![0, 143].includes(container.exit_code)) ||
    Boolean(container.container_error)
  );
}

function needsAttention(container: Container) {
  return container.update_available || isUnhealthy(container) || hasRepeatedRestart(container) || hasStoppedContainerProblem(container);
}

function attentionReason(container: Container) {
  if (container.oom_killed) return "OOM killed";
  if (container.container_error) return "Runtime error";
  if (container.exit_code !== null && ![0, 143].includes(container.exit_code)) return `Exited with code ${container.exit_code}`;
  if (container.state === "dead") return "Container is dead";
  if (isUnhealthy(container)) return "Health check failing";
  if (hasRepeatedRestart(container)) return "Repeated restart";
  if (container.update_available) return "Image update pending";
  return "Needs review";
}

function eventNeedsAttention(event: ContainerEvent) {
  return event.alerted || ["crash", "oom", "kill"].includes(event.event_type);
}

function eventLabel(event: ContainerEvent) {
  const labels: Record<string, string> = {
    crash: "Container crashed",
    oom: "Out of memory",
    kill: "Container killed",
    restart: "Container restarted",
  };
  return labels[event.event_type] ?? `Container ${event.event_type}`;
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  detail: string;
  tone?: "default" | "danger" | "warn" | "good";
}) {
  const valueClass = tone === "danger" ? "text-red-300" : tone === "warn" ? "text-blue-300" : tone === "good" ? "text-emerald-300" : "text-slate-100";
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase text-slate-500">{label}</p>
        <span className="text-slate-600">{icon}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export default function Dashboard() {
  const { isAuthenticated } = useAuth();
  const tz = useTimezone();
  const { data: containers = [], isLoading, isError } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
    refetchInterval: 10_000,
    enabled: isAuthenticated,
  });
  const { data: events = [] } = useQuery<ContainerEvent[]>({
    queryKey: ["events", "dashboard-attention"],
    queryFn: () => api.events.list(undefined, 50),
    refetchInterval: 15_000,
    enabled: isAuthenticated,
  });

  const summary = useMemo(() => {
    const running = containers.filter((container) => container.state === "running").length;
    const attention = containers.filter(needsAttention);
    const updates = containers.filter((container) => container.update_available).length;
    const totalMemory = containers.reduce((sum, container) => sum + container.mem_usage, 0);
    const memoryLimit = containers.reduce((sum, container) => sum + container.mem_limit, 0);
    const avgCpu = running > 0
      ? containers.filter((container) => container.state === "running").reduce((sum, container) => sum + container.cpu_percent, 0) / running
      : 0;
    const services = new Map<string, Container[]>();
    for (const container of containers) {
      if (!container.compose_project) continue;
      const members = services.get(container.compose_project) ?? [];
      members.push(container);
      services.set(container.compose_project, members);
    }
    const servicesNeedingAttention = Array.from(services.values()).filter((members) => members.some(needsAttention)).length;

    return {
      attention,
      avgCpu,
      memoryLimit,
      running,
      services: services.size,
      servicesNeedingAttention,
      totalMemory,
      updates,
    };
  }, [containers]);

  const attentionEvents = useMemo(() => events.filter(eventNeedsAttention).slice(0, 4), [events]);
  const memoryPercent = summary.memoryLimit > 0 ? Math.round((summary.totalMemory / summary.memoryLimit) * 100) : null;

  return (
    <>
      <AnalyticsBanner />
      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-surface-1 p-5 lg:p-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_32rem] xl:items-start">
            <div>
              <h2 className="text-2xl font-semibold text-slate-100">Fleet overview</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/services" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-accent/40 hover:text-accent">
                  Open Services <FiArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link to="/containers" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-accent/40 hover:text-accent">
                  Open Containers <FiArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Metric icon={<FiBox className="h-4 w-4" />} label="Fleet" value={`${summary.running}/${containers.length}`} detail="containers running" tone={summary.running === containers.length && containers.length > 0 ? "good" : "default"} />
              <Metric icon={<FiAlertTriangle className="h-4 w-4" />} label="Needs attention" value={summary.attention.length} detail={summary.attention.length === 1 ? "actionable container" : "actionable containers"} tone={summary.attention.length > 0 ? "danger" : "good"} />
              <Metric icon={<FiArrowUp className="h-4 w-4" />} label="Updates" value={summary.updates} detail="image updates pending" tone={summary.updates > 0 ? "warn" : "default"} />
              <Metric icon={<FiZap className="h-4 w-4" />} label="Resource pulse" value={`${summary.avgCpu.toFixed(1)}%`} detail={`avg CPU · ${memoryPercent !== null ? `${memoryPercent}% memory` : formatBytes(summary.totalMemory)}`} />
            </div>
          </div>
        </section>

        {isLoading && <div className="py-16 text-center text-slate-500">Connecting to collector…</div>}
        {isError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">Unable to reach the Nestview backend.</div>}

        {!isLoading && !isError && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
            <section className="rounded-xl border border-border bg-surface-1 p-5">
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-lg font-semibold text-slate-100">Needs attention</h2>
                <Link to="/containers" className="text-sm text-accent transition-colors hover:text-blue-300">View all</Link>
              </div>

              <div className="mt-4 space-y-2">
                {summary.attention.slice(0, 6).map((container) => (
                  <Link
                    key={container.docker_id}
                    to={`/containers/${container.docker_id}`}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-2 px-3 py-3 transition-colors hover:border-accent/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-100">{container.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{container.compose_project ?? "Standalone"}</span>
                    </span>
                    <span className={`shrink-0 rounded border px-2 py-1 text-xs ${container.update_available && !isUnhealthy(container) && !hasStoppedContainerProblem(container) ? "border-blue-500/30 bg-blue-500/10 text-blue-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
                      {attentionReason(container)}
                    </span>
                  </Link>
                ))}
                {summary.attention.length === 0 && (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-4 text-sm text-emerald-200">No current exceptions need action.</div>
                )}
              </div>
            </section>

            <div className="space-y-6">
              <section className="rounded-xl border border-border bg-surface-1 p-5">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-lg font-semibold text-slate-100">Services</h2>
                  <FiLayers className="h-5 w-5 text-slate-600" />
                </div>
                <p className="mt-4 text-3xl font-semibold text-slate-100">{summary.services}</p>
                <p className="mt-1 text-sm text-slate-500">Compose-derived services</p>
                <p className={`mt-4 text-sm ${summary.servicesNeedingAttention > 0 ? "text-red-300" : "text-emerald-300"}`}>
                  {summary.servicesNeedingAttention > 0 ? `${summary.servicesNeedingAttention} service${summary.servicesNeedingAttention === 1 ? "" : "s"} need review` : "No services need review"}
                </p>
                <Link to="/services" className="mt-4 inline-flex items-center gap-1 text-sm text-accent transition-colors hover:text-blue-300">Open Services <FiArrowRight className="h-3.5 w-3.5" /></Link>
              </section>

              <section className="rounded-xl border border-border bg-surface-1 p-5">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-lg font-semibold text-slate-100">Events to review</h2>
                  <FiAlertTriangle className="h-5 w-5 text-slate-600" />
                </div>
                <div className="mt-4 space-y-3">
                  {attentionEvents.map((event) => (
                    <Link key={event.id} to={`/containers/${event.container_id}`} className="block rounded-lg border border-border bg-surface-2 px-3 py-2 transition-colors hover:border-accent/40">
                      <p className="truncate text-sm text-slate-200"><span className="font-medium">{event.container_name}</span> · {eventLabel(event)}</p>
                      <p className="mt-1 text-xs text-slate-600">{formatDateTime(event.timestamp, tz)}</p>
                    </Link>
                  ))}
                  {attentionEvents.length === 0 && <p className="rounded-lg border border-border bg-surface-2 px-3 py-4 text-sm text-slate-500">No recent events require attention.</p>}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
