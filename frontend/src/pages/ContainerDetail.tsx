import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

function NetworkIOChart({ data }: { data: NetworkHistoryPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        No network history available yet
      </div>
    );
  }

  const PAD = { top: 12, right: 16, bottom: 28, left: 56 };
  const W = 500;
  const H = 160;
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const allValues = [...data.map((d) => d.rx_bytes), ...data.map((d) => d.tx_bytes)];
  const maxVal = Math.max(...allValues, 1);

  const toX = (i: number) =>
    data.length === 1 ? PAD.left + cW / 2 : PAD.left + (i / (data.length - 1)) * cW;
  const toY = (v: number) => PAD.top + (1 - v / maxVal) * cH;

  const rxPoints = data.map((d, i) => `${toX(i)},${toY(d.rx_bytes)}`).join(" ");
  const txPoints = data.map((d, i) => `${toX(i)},${toY(d.tx_bytes)}`).join(" ");

  const yTicks = [0, 0.33, 0.66, 1].map((f) => ({
    val: maxVal * f,
    y: PAD.top + (1 - f) * cH,
  }));

  const xTickCount = 4;
  const xTickIndices = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i / (xTickCount - 1)) * (data.length - 1))
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* Grid lines + Y axis labels */}
      {yTicks.map(({ val, y }) => (
        <g key={y}>
          <line
            x1={PAD.left}
            y1={y}
            x2={PAD.left + cW}
            y2={y}
            stroke="#1e293b"
            strokeWidth={1}
          />
          <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#64748b">
            {formatBytes(Math.round(val))}
          </text>
        </g>
      ))}

      {/* X axis time labels */}
      {xTickIndices.map((idx) => {
        const ts = new Date(
          data[idx].recorded_at.endsWith("Z") ? data[idx].recorded_at : data[idx].recorded_at + "Z"
        );
        const label = ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        return (
          <text key={idx} x={toX(idx)} y={H - 6} textAnchor="middle" fontSize={10} fill="#64748b">
            {label}
          </text>
        );
      })}

      {/* Series lines or dots for single-point data */}
      {data.length === 1 ? (
        <>
          <circle cx={toX(0)} cy={toY(data[0].rx_bytes)} r={3} fill="#22d3ee" />
          <circle cx={toX(0)} cy={toY(data[0].tx_bytes)} r={3} fill="#f97316" />
        </>
      ) : (
        <>
          <polyline points={rxPoints} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeLinejoin="round" />
          <polyline points={txPoints} fill="none" stroke="#f97316" strokeWidth={1.5} strokeLinejoin="round" />
        </>
      )}

      {/* Legend */}
      <g transform={`translate(${PAD.left + cW - 62}, ${PAD.top + 2})`}>
        <rect x={0} y={0} width={62} height={32} rx={4} fill="#0f172a" opacity={0.85} />
        <line x1={6} y1={11} x2={18} y2={11} stroke="#22d3ee" strokeWidth={1.5} />
        <text x={22} y={15} fontSize={10} fill="#94a3b8">RX</text>
        <line x1={6} y1={23} x2={18} y2={23} stroke="#f97316" strokeWidth={1.5} />
        <text x={22} y={27} fontSize={10} fill="#94a3b8">TX</text>
      </g>
    </svg>
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
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Network I/O</h2>
        <div className="card p-4">
          <NetworkIOChart data={networkHistory} />
        </div>
      </section>

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
