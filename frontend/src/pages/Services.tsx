import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FiArrowRight,
  FiBox,
  FiCheck,
  FiChevronDown,
  FiChevronRight,
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

interface ServiceGroup {
  id: string;
  name: string;
  source: "compose";
  members: Container[];
}

const SETUP_MODE_KEY = "nestview:services-setup-mode";

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
      const toneOrder = { danger: 0, warn: 1, good: 2 };
      return toneOrder[serviceTone(a)] - toneOrder[serviceTone(b)] || a.name.localeCompare(b.name);
    });
}

function StatTile({ label, value, subtext }: { label: string; value: string | number; subtext: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 px-4 py-3">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{subtext}</p>
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
  isChecking,
  onCheckUpdates,
}: {
  service: ServiceGroup;
  isChecking: boolean;
  onCheckUpdates: (service: ServiceGroup) => void;
}) {
  const [membersOpen, setMembersOpen] = useState(false);
  const running = runningCount(service.members);
  const updates = service.members.filter((container) => container.update_available).length;
  const unhealthy = service.members.filter((container) => container.state !== "running" || container.health_status === "unhealthy").length;
  const totalCpu = service.members
    .filter((container) => container.state === "running")
    .reduce((sum, container) => sum + container.cpu_percent, 0);
  const totalMemUsage = service.members.reduce((sum, container) => sum + container.mem_usage, 0);
  const totalMemLimit = service.members.reduce((sum, container) => sum + container.mem_limit, 0);
  const tone = serviceTone(service);
  const health = serviceHealth(service);
  const dotColor = tone === "danger" ? "bg-red-400" : tone === "warn" ? "bg-blue-300" : "bg-emerald-400";
  const borderColor = tone === "danger" ? "border-red-500/35" : tone === "warn" ? "border-blue-500/30" : "border-border";

  return (
    <article className={`rounded-lg border ${borderColor} bg-surface-1`}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
              <h3 className="truncate text-base font-semibold text-slate-100">{service.name}</h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Compose stack · {running}/{service.members.length} running</span>
              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 ${health.className}`}>
                {health.label}
              </span>
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
          <p className="mt-1 font-mono text-sm text-slate-200">{totalCpu.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-600">Memory</p>
          <p className="mt-1 font-mono text-sm text-slate-200">
            {totalMemLimit > 0 ? `${Math.round((totalMemUsage / totalMemLimit) * 100)}%` : formatBytes(totalMemUsage)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-600">Attention</p>
          <p className={`mt-1 font-mono text-sm ${unhealthy + updates > 0 ? "text-blue-300" : "text-slate-200"}`}>
            {unhealthy + updates}
          </p>
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={() => setMembersOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 text-left text-sm text-slate-300 transition-colors hover:text-slate-100"
          aria-expanded={membersOpen}
        >
          <span className="font-medium">Containers</span>
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            {service.members.length} member{service.members.length === 1 ? "" : "s"}
            <FiChevronDown className={`h-4 w-4 transition-transform ${membersOpen ? "rotate-180" : ""}`} />
          </span>
        </button>

        {membersOpen && (
          <div className="mt-3 space-y-1.5">
            {service.members.map((container) => (
              <Link
                key={container.docker_id}
                to={`/containers/${container.docker_id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm transition-colors hover:border-accent/50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-200">{container.compose_service ?? container.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-600">
                    {container.started_at && container.state === "running" ? formatUptime(container.started_at) : container.status}
                  </span>
                </span>
                <span className="inline-flex items-center gap-2">
                  {container.health_status && (
                    <span className="rounded border border-border bg-surface-3 px-1.5 py-0.5 text-xs text-slate-400">
                      {container.health_status}
                    </span>
                  )}
                  {container.update_available && <span className="text-xs text-blue-300">Update</span>}
                  <StatusBadge state={container.state} />
                  <FiChevronRight className="h-3.5 w-3.5 text-slate-600" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
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
    if (!q) return composeServices;
    return composeServices.filter((service) => {
      return [
        service.name,
        ...service.members.flatMap((container) => [container.name, container.compose_service ?? "", container.image]),
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [composeServices, search]);

  const runningServices = composeServices.filter((service) => runningCount(service.members) === service.members.length).length;
  const servicesWithAttention = composeServices.filter((service) => serviceTone(service) !== "good").length;
  const updateCount = containers.filter((container) => container.update_available).length;

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
            <StatTile label="Services" value={setupMode === "compose" ? composeServices.length : 0} subtext={setupMode === "compose" ? `${runningServices} fully running` : "manual groups pending"} />
            <StatTile label="Attention" value={setupMode === "compose" ? servicesWithAttention : 0} subtext="services with issues or updates" />
            <StatTile label="Ungrouped" value={standalone.length} subtext="standalone containers" />
            <StatTile label="Updates" value={updateCount} subtext="available image updates" />
          </section>

          {setupMode === "blank" ? (
            <BlankState composeCount={composeServices.length} onUseCompose={() => chooseMode("compose")} />
          ) : (
            <>
              <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FiSearch className="h-4 w-4 shrink-0 text-slate-600" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search services, containers, images..."
                    className="w-full min-w-0 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1">
                    <FiCheck className="h-3.5 w-3.5 text-emerald-400" />
                    Compose seeded
                  </span>
                  <Link
                    to="/containers"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    Containers
                    <FiArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </section>

              {visibleServices.length > 0 ? (
                <section className="grid gap-4 xl:grid-cols-2">
                  {visibleServices.map((service) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      isChecking={checkingProject === service.id}
                      onCheckUpdates={(service) => checkUpdatesMutation.mutate(service)}
                    />
                  ))}
                </section>
              ) : (
                <section className="rounded-lg border border-dashed border-border bg-surface-1 px-6 py-12 text-center">
                  <FiSearch className="mx-auto h-8 w-8 text-slate-600" />
                  <p className="mt-3 text-sm font-medium text-slate-300">No matching services</p>
                  <p className="mt-1 text-sm text-slate-500">Try a different service, container, or image search.</p>
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
