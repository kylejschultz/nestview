import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { Container, NetworkHistoryPoint } from "../types";
import StatusBadge from "../components/StatusBadge";
import MetricBar from "../components/MetricBar";
import LogViewer from "../components/LogViewer";
import EventTimeline from "../components/EventTimeline";
import ConfirmModal from "../components/ConfirmModal";
import type { ProgressStep } from "../components/ConfirmModal";
import Toast from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { formatBytes, formatUptime, formatDateTime } from "../utils";
import { useTimezone } from "../TimezoneContext";

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ── Action buttons ────────────────────────────────────────────────────────────

type ActionType = "stop" | "restart" | "start" | "update-and-restart";

interface ActionButtonsProps {
  container: Container;
}

const STEP_DEFINITIONS: Record<ActionType, ProgressStep[]> = {
  stop: [
    { id: "stopping",  label: "Stopping container…", status: "pending" },
    { id: "confirmed", label: "Container stopped",    status: "pending" },
  ],
  start: [
    { id: "starting",  label: "Starting container…", status: "pending" },
    { id: "confirmed", label: "Container running",   status: "pending" },
  ],
  restart: [
    { id: "stopping",  label: "Stopping container…", status: "pending" },
    { id: "starting",  label: "Starting container…", status: "pending" },
    { id: "confirmed", label: "Container running",   status: "pending" },
  ],
  "update-and-restart": [
    { id: "fetching",   label: "Fetching latest image…", status: "pending" },
    { id: "restarting", label: "Restarting container…",  status: "pending" },
    { id: "confirming", label: "Confirming running…",    status: "pending" },
    { id: "complete",   label: "Complete",               status: "pending" },
  ],
};

function ActionButtons({ container }: ActionButtonsProps) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const { toastState, showToast, dismissToast } = useToast();

  // Progress state
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs for polling (avoid stale closures)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressStepsRef = useRef<ProgressStep[]>([]);
  const actionRef = useRef<ActionType | null>(null);
  const initialDigestCheckRef = useRef<string | null>(null);
  const initialStartedAtRef = useRef<string | null>(null);

  const ACTION_SUCCESS_MESSAGES: Record<ActionType, string> = {
    stop:                 "Container stopped",
    start:                "Container started",
    restart:              "Container restarted",
    "update-and-restart": "Update & Restart complete",
  };

  function updateSteps(steps: ProgressStep[]) {
    progressStepsRef.current = steps;
    setProgressSteps(steps);
  }

  function setStepStatus(id: string, status: ProgressStep["status"]) {
    const updated = progressStepsRef.current.map(s => s.id === id ? { ...s, status } : s);
    updateSteps(updated);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function resetProgress() {
    updateSteps([]);
    setIsComplete(false);
    setHasError(false);
    setErrorMessage(null);
    stopPolling();
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function advanceSteps(action: ActionType, fresh: Container, initialDigestCheck: string | null) {
    if (action === "stop") {
      if (fresh.state === "exited" || fresh.state === "dead") {
        setStepStatus("stopping", "done");
        setStepStatus("confirmed", "done");
        stopPolling();
        setIsComplete(true);
      } else {
        setStepStatus("stopping", "active");
      }
    } else if (action === "start") {
      if (fresh.state === "running") {
        setStepStatus("starting", "done");
        setStepStatus("confirmed", "done");
        stopPolling();
        setIsComplete(true);
      } else {
        setStepStatus("starting", "active");
      }
    } else if (action === "restart") {
      const stoppingDone = progressStepsRef.current.find(s => s.id === "stopping")?.status === "done";
      const restarted =
        fresh.state === "running" &&
        fresh.started_at !== null &&
        fresh.started_at !== initialStartedAtRef.current;

      if (restarted) {
        setStepStatus("stopping", "done");
        setStepStatus("starting", "done");
        setStepStatus("confirmed", "done");
        stopPolling();
        setIsComplete(true);
      } else if (!stoppingDone) {
        if (fresh.state !== "running") {
          setStepStatus("stopping", "done");
          setStepStatus("starting", "active");
        } else {
          setStepStatus("stopping", "active");
        }
      } else {
        if (fresh.state === "running") {
          setStepStatus("starting", "done");
          setStepStatus("confirmed", "done");
          stopPolling();
          setIsComplete(true);
        }
      }
    } else if (action === "update-and-restart") {
      const restartingDone = progressStepsRef.current.find(s => s.id === "restarting")?.status === "done";
      const confirmingDone = progressStepsRef.current.find(s => s.id === "confirming")?.status === "done";

      if (!restartingDone) {
        const restarted =
          fresh.state === "running" &&
          fresh.started_at !== null &&
          fresh.started_at !== initialStartedAtRef.current;

        if (restarted) {
          setStepStatus("restarting", "done");
          setStepStatus("confirming", "active");
        } else if (fresh.state !== "running") {
          setStepStatus("restarting", "active");
        }
      } else if (!confirmingDone) {
        if (fresh.state === "running") {
          setStepStatus("confirming", "done");
          setStepStatus("complete", "done");
          stopPolling();
          setIsComplete(true);
        }
      }
    }
  }

  function startPolling(action: ActionType, initialDigestCheck: string | null) {
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      const activeStep = progressStepsRef.current.find(s => s.status === "active");
      if (activeStep) setStepStatus(activeStep.id, "error");
      setHasError(true);
      setErrorMessage("Timed out waiting for confirmation. The action may have completed — check the dashboard.");
    }, 30_000);

    pollRef.current = setInterval(async () => {
      try {
        const fresh = await api.containers.get(container.docker_id);
        advanceSteps(action, fresh, initialDigestCheck);
      } catch {
        // ignore poll errors
      }
    }, 500);
  }

  // Cleanup on unmount
  useEffect(() => () => {
    stopPolling();
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Toast + query invalidation on completion
  useEffect(() => {
    if (!isComplete || !actionRef.current) return;
    showToast(ACTION_SUCCESS_MESSAGES[actionRef.current], "success");
    queryClient.invalidateQueries({ queryKey: ["container", container.docker_id] });
    queryClient.invalidateQueries({ queryKey: ["containers"] });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  // Toast on error
  useEffect(() => {
    if (!hasError || !errorMessage) return;
    showToast(errorMessage, "error");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasError]);

  // Separate lightweight mutation for Check for Updates (no progress modal, just toast)
  const { mutate: runCheckForUpdates } = useMutation({
    mutationFn: () => api.containers.checkForUpdates(container.docker_id),
    onMutate: () => setIsCheckingUpdates(true),
    onSuccess: (data) => {
      setIsCheckingUpdates(false);
      const msg = data.update_available ? "Update available" : "Already up to date";
      showToast(msg, "success");
      queryClient.invalidateQueries({ queryKey: ["container", container.docker_id] });
      queryClient.invalidateQueries({ queryKey: ["containers"] });
    },
    onError: (err: Error) => {
      setIsCheckingUpdates(false);
      showToast(err.message, "error");
    },
  });

  const { mutate, isPending: mutationIsPending } = useMutation({
    mutationFn: (action: ActionType) => {
      if (action === "update-and-restart") return api.containers.updateAndRestart(container.docker_id);
      return api.containers[action](container.docker_id);
    },
    onMutate: (action: ActionType) => {
      actionRef.current = action;
      initialDigestCheckRef.current = container.last_digest_check;
      initialStartedAtRef.current = container.started_at;
      const steps = STEP_DEFINITIONS[action].map(s => ({ ...s }));
      steps[0] = { ...steps[0], status: "active" };
      updateSteps(steps);
    },
    onSuccess: (data, action) => {
      if (action === "update-and-restart") {
        setStepStatus("fetching", "done");
        const result = data as unknown as { restarted: boolean };
        if (!result.restarted) {
          // Image was already up to date — no restart needed
          setStepStatus("restarting", "done");
          setStepStatus("confirming", "done");
          setStepStatus("complete", "done");
          stopPolling();
          setIsComplete(true);
          return;
        }
        setStepStatus("restarting", "active");
      }
      startPolling(action, initialDigestCheckRef.current);
    },
    onError: (err: Error) => {
      stopPolling();
      const activeStep = progressStepsRef.current.find(s => s.status === "active");
      if (activeStep) setStepStatus(activeStep.id, "error");
      setHasError(true);
      setErrorMessage(err.message);
    },
  });

  function requestAction(action: ActionType) {
    setPendingAction(action);
  }

  function confirmAction() {
    if (!pendingAction) return;
    mutate(pendingAction);
  }

  const isPending = mutationIsPending || progressSteps.length > 0;

  // Determine which buttons to show
  const state = container.state;
  const showStop             = state === "running" || state === "restarting" || state === "paused";
  const showRestart          = showStop;
  const showStart            = state === "exited" || state === "created" || state === "dead";
  const showUpdateAndRestart = showStop && container.update_available;

  const BUTTON_STYLES: Record<ActionType, string> = {
    stop:                 "border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-400",
    restart:              "border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 hover:border-yellow-400",
    start:                "border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-400",
    "update-and-restart": "border-blue-400 text-blue-400 hover:bg-blue-500/10",
  };

  const modalMessages: Record<ActionType, string> = {
    stop:                 `Are you sure you want to stop ${container.name}?`,
    restart:              `Are you sure you want to restart ${container.name}?`,
    start:                `Are you sure you want to start ${container.name}?`,
    "update-and-restart": `Update ${container.name} to the latest image and restart? The container will only restart if a new image is available.`,
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

      {pendingAction && (
        <ConfirmModal
          message={modalMessages[pendingAction]}
          onConfirm={confirmAction}
          onCancel={() => { resetProgress(); setPendingAction(null); }}
          isPending={isPending}
          progressSteps={progressSteps}
          isComplete={isComplete}
          hasError={hasError}
          errorMessage={errorMessage ?? undefined}
        />
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {showRestart && (
            <button
              disabled={isPending || isCheckingUpdates}
              onClick={() => requestAction("restart")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_STYLES.restart}`}
            >
              {isPending && pendingAction === "restart" ? <Spinner /> : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Restart
            </button>
          )}
          {showStop && (
            <button
              disabled={isPending || isCheckingUpdates}
              onClick={() => requestAction("stop")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_STYLES.stop}`}
            >
              {isPending && pendingAction === "stop" ? <Spinner /> : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 10h6v4H9z" />
                </svg>
              )}
              Stop
            </button>
          )}
          {showStart && (
            <button
              disabled={isPending || isCheckingUpdates}
              onClick={() => requestAction("start")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_STYLES.start}`}
            >
              {isPending && pendingAction === "start" ? <Spinner /> : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              Start
            </button>
          )}
          <button
            disabled={isPending || isCheckingUpdates}
            onClick={() => runCheckForUpdates()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-slate-600 text-slate-400 hover:bg-surface-3 hover:border-slate-500"
          >
            {isCheckingUpdates ? <Spinner /> : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            Check for Updates
          </button>
          {showUpdateAndRestart && (
            <button
              disabled={isPending || isCheckingUpdates}
              onClick={() => requestAction("update-and-restart")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_STYLES["update-and-restart"]}`}
            >
              {isPending && pendingAction === "update-and-restart" ? <Spinner /> : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Update &amp; Restart
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Network I/O chart ─────────────────────────────────────────────────────────

// All values are IEC (1024-based) so formatBytes() displays clean round numbers.
const TIER_STEPS = [
  1_024,           // 1 KB
  5_120,           // 5 KB
  10_240,          // 10 KB
  25_600,          // 25 KB
  51_200,          // 50 KB
  102_400,         // 100 KB
  256_000,         // 250 KB
  512_000,         // 500 KB
  1_048_576,       // 1 MB
  5_242_880,       // 5 MB
  10_485_760,      // 10 MB
  26_214_400,      // 25 MB
  52_428_800,      // 50 MB
  104_857_600,     // 100 MB
  262_144_000,     // 250 MB
  524_288_000,     // 500 MB
  1_073_741_824,   // 1 GB
  2_684_354_560,   // 2.5 GB
  5_368_709_120,   // 5 GB
  10_737_418_240,  // 10 GB
];

function tieredCeiling(rawMax: number): number {
  for (const t of TIER_STEPS) {
    if (rawMax <= t) return t;
  }
  return TIER_STEPS[TIER_STEPS.length - 1];
}

interface NetIOTooltipProps {
  active?: boolean;
  payload?: { dataKey?: string; value?: number; payload?: NetworkHistoryPoint }[];
}

function NetIOTooltip({ active, payload }: NetIOTooltipProps) {
  if (!active || !payload?.length) return null;
  const raw = payload[0].payload?.recorded_at ?? "";
  const ts = new Date(raw.endsWith("Z") ? raw : raw + "Z");
  const date = ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const rx = payload.find((p) => p.dataKey === "rx_bytes")?.value ?? 0;
  const tx = payload.find((p) => p.dataKey === "tx_bytes")?.value ?? 0;
  return (
    <div className="rounded border border-slate-700 bg-[#0f172a] px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span className="inline-block w-4 border-t-2 border-[#22d3ee]" />
        <span className="text-slate-300">{formatBytes(rx as number)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block w-4 border-t-2 border-[#f97316]" />
        <span className="text-slate-300">{formatBytes(tx as number)}</span>
      </div>
      <div className="text-slate-500 pt-0.5">{date}, {time}</div>
    </div>
  );
}

function NetworkIOChart({ data }: { data: NetworkHistoryPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-slate-500 text-sm">
        No network history available yet
      </div>
    );
  }

  const allValues = [...data.map((d) => d.rx_bytes), ...data.map((d) => d.tx_bytes)];
  const rawMax = Math.max(...allValues, 1);
  const maxVal = tieredCeiling(rawMax);

  return (
    <div className="w-full px-4">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="recorded_at"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(val: string) => {
              const ts = new Date(val.endsWith("Z") ? val : val + "Z");
              return ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            }}
            interval="preserveStartEnd"
            minTickGap={48}
          />
          <YAxis
            domain={[0, maxVal]}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(v: number) => formatBytes(v)}
            width={80}
            ticks={[0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal]}
          />
          <Tooltip content={<NetIOTooltip />} cursor={{ stroke: "#475569", strokeWidth: 1, strokeDasharray: "3 3" }} />
          <Line
            type="monotone"
            dataKey="rx_bytes"
            stroke="#22d3ee"
            strokeWidth={1.5}
            dot={data.length === 1 ? { r: 3, fill: "#22d3ee" } : false}
            activeDot={{ r: 3, fill: "#22d3ee" }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="tx_bytes"
            stroke="#f97316"
            strokeWidth={1.5}
            dot={data.length === 1 ? { r: 3, fill: "#f97316" } : false}
            activeDot={{ r: 3, fill: "#f97316" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-border last:border-0">
      <span className="text-sm text-slate-500 w-32 shrink-0">{label}</span>
      <span className="text-sm text-slate-200 font-mono break-all">{value}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContainerDetail() {
  const { id } = useParams<{ id: string }>();
  const tz = useTimezone();
  const { isAuthenticated } = useAuth();
  const [netExpanded, setNetExpanded] = useState(true);

  const { data: container, isLoading, isError } = useQuery<Container>({
    queryKey: ["container", id],
    queryFn: () => api.containers.get(id!),
    refetchInterval: (query) => {
      const state = (query.state.data as Container | undefined)?.state;
      if (state && ["restarting", "created"].includes(state)) return 2_000;
      return 10_000;
    },
    enabled: !!id && isAuthenticated,
  });

  const { data: networkHistory = [] } = useQuery<NetworkHistoryPoint[]>({
    queryKey: ["network-history", id],
    queryFn: () => api.containers.networkHistory(id!),
    enabled: !!id && isAuthenticated,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  if (isLoading) {
    return <div className="text-center py-16 text-slate-500">Loading…</div>;
  }

  if (isError || !container) {
    return (
      <div className="text-center py-16">
        <p className="text-red-400 mb-4">Container not found.</p>
        <Link to="/" className="text-accent hover:text-accent-hover">← Back to dashboard</Link>
      </div>
    );
  }

  const memPct = container.mem_limit > 0 ? (container.mem_usage / container.mem_limit) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb + title */}
      <div className="space-y-2">
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-300 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-100">{container.name}</h1>
          <StatusBadge state={container.state} />
          {container.compose_project && (
            <span className="badge bg-surface-3 text-slate-400 border border-border">
              {container.compose_project}{container.compose_service ? ` / ${container.compose_service}` : ""}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 font-mono">{container.image}</p>
      </div>

      {/* Action buttons */}
      <ActionButtons container={container} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stats */}
        {container.state === "running" && (
          <div className="card p-4 space-y-4">
            <h2 className="text-sm font-medium text-slate-300">Live Stats</h2>
            <MetricBar
              label="CPU"
              value={container.cpu_percent}
              display={`${container.cpu_percent.toFixed(2)}%`}
            />
            <MetricBar
              label="Memory"
              value={memPct}
              display={
                container.mem_limit > 0
                  ? `${formatBytes(container.mem_usage)} / ${formatBytes(container.mem_limit)}`
                  : formatBytes(container.mem_usage)
              }
            />
            <div className="pt-2 space-y-1 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Uptime</span>
                <span className="font-mono">
                  {container.started_at ? formatUptime(container.started_at) : "—"}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Restarts</span>
                <span className={`font-mono ${container.restart_count > 0 ? "text-yellow-400" : ""}`}>
                  {container.restart_count}
                </span>
              </div>
              {container.created_at && (
                <div className="flex justify-between text-slate-400">
                  <span>Created</span>
                  <span className="font-mono text-xs">{formatDateTime(container.created_at, tz)}</span>
                </div>
              )}
              {container.started_at && (
                <div className="flex justify-between text-slate-400">
                  <span>Started</span>
                  <span className="font-mono text-xs">{formatDateTime(container.started_at, tz)}</span>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Info */}
        <div className={`card px-4 ${container.state === "running" ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <h2 className="text-sm font-medium text-slate-300 py-3">Details</h2>
          <InfoRow label="ID" value={container.short_id} />
          <InfoRow label="Image" value={container.image.includes(":") ? container.image.slice(0, container.image.lastIndexOf(":")) : container.image} />
          {container.image.includes(":") && (
            <InfoRow label="Tag" value={container.image.split(":").pop()!} />
          )}
          <InfoRow label="State" value={<StatusBadge state={container.state} />} />
          {container.ports.length > 0 && (
            <InfoRow
              label="Ports"
              value={
                <div className="flex flex-wrap gap-1">
                  {container.ports.map((p) => (
                    <span key={p} className="badge bg-surface-3 text-slate-300 border border-border">{p}</span>
                  ))}
                </div>
              }
            />
          )}
          {container.networks.length > 0 && (
            <InfoRow
              label="Networks"
              value={
                <div className="flex flex-wrap gap-1">
                  {container.networks.map((n) => (
                    <span key={n} className="badge bg-surface-3 text-slate-300 border border-border">{n}</span>
                  ))}
                </div>
              }
            />
          )}
          {container.volumes.length > 0 && (
            <InfoRow
              label="Volumes"
              value={
                <div className="space-y-1">
                  {container.volumes.map((v) => (
                    <div key={v} className="text-xs">{v}</div>
                  ))}
                </div>
              }
            />
          )}
          {container.image_size != null && (
            <InfoRow label="Image size" value={formatBytes(container.image_size)} />
          )}
          {container.last_digest_check != null && (
            <InfoRow
              label="Update check"
              value={
                <span className="flex items-center gap-2 flex-wrap">
                  <span>{formatDateTime(container.last_digest_check, tz)}</span>
                  {container.update_available && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                      Update available
                    </span>
                  )}
                </span>
              }
            />
          )}
        </div>
      </div>

      {/* Network I/O */}
      <div className="card">
        <button
          onClick={() => setNetExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-medium text-slate-300">Network I/O</span>
          <svg
            className={`w-4 h-4 text-slate-500 transition-transform ${netExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {netExpanded && (
          <div className="pb-4 space-y-3">
            <div className="flex gap-4 text-xs text-slate-400 px-4">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="2" aria-hidden="true">
                  <line x1="0" y1="1" x2="16" y2="1" stroke="#22d3ee" strokeWidth="2" />
                </svg>
                RX
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="2" aria-hidden="true">
                  <line x1="0" y1="1" x2="16" y2="1" stroke="#f97316" strokeWidth="2" />
                </svg>
                TX
              </span>
            </div>
            <NetworkIOChart data={networkHistory} />
          </div>
        )}
      </div>

      {/* Logs */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Logs</h2>
        <LogViewer dockerId={container.docker_id} />
      </section>

      {/* Events */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Events</h2>
        <EventTimeline dockerId={container.docker_id} />
      </section>
    </div>
  );
}
