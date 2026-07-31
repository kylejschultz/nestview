import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "../router";
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
import {
  FiActivity,
  FiAlertTriangle,
  FiArrowLeft,
  FiArrowUp,
  FiBox,
  FiChevronDown,
  FiChevronUp,
  FiClock,
  FiCpu,
  FiDatabase,
  FiFileText,
  FiHardDrive,
  FiHeart,
  FiRefreshCw,
  FiWifi,
} from "react-icons/fi";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { Container, MetricsHistoryPoint, NetworkHistoryPoint, OperationStatus } from "../types";
import StatusBadge from "../components/StatusBadge";
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

type ActionType = "stop" | "restart" | "start" | "check-for-updates" | "update-and-restart";

interface ActionButtonsProps {
  container: Container;
  onModalOpenChange?: (open: boolean) => void;
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
  "check-for-updates": [
    { id: "checking", label: "Checking registry digest…", status: "pending" },
    { id: "complete", label: "Update check complete",     status: "pending" },
  ],
  "update-and-restart": [
    { id: "fetching",   label: "Fetching latest image…", status: "pending" },
    { id: "restarting", label: "Restarting container…",  status: "pending" },
    { id: "confirming", label: "Confirming running…",    status: "pending" },
    { id: "complete",   label: "Complete",               status: "pending" },
  ],
};

function ActionButtons({ container, onModalOpenChange }: ActionButtonsProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tz = useTimezone();
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const { toastState, showToast, dismissToast } = useToast();

  // Progress state
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [operationStatus, setOperationStatus] = useState<OperationStatus | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [nextContainerId, setNextContainerId] = useState<string | null>(null);

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
    "check-for-updates":  "Update check complete",
    restart:              "Container restarted",
    "update-and-restart": "Update & Restart complete",
  };

  useEffect(() => {
    onModalOpenChange?.(pendingAction !== null);
  }, [onModalOpenChange, pendingAction]);

  function updateSteps(steps: ProgressStep[]) {
    progressStepsRef.current = steps;
    setProgressSteps(steps);
  }

  function setStepStatus(id: string, status: ProgressStep["status"]) {
    const updated = progressStepsRef.current.map(s => s.id === id ? { ...s, status } : s);
    updateSteps(updated);
  }

  function stepsFromUpdateOperation(operation: OperationStatus): ProgressStep[] {
    const steps = STEP_DEFINITIONS["update-and-restart"].map(s => ({ ...s }));
    const setStatus = (id: string, status: ProgressStep["status"]) => {
      const step = steps.find(s => s.id === id);
      if (step) step.status = status;
    };
    const markDone = (...ids: string[]) => ids.forEach(id => setStatus(id, "done"));

    if (operation.status === "succeeded" || operation.status === "skipped") {
      steps.forEach(s => { s.status = "done"; });
      return steps;
    }

    if (operation.status === "failed") {
      if (operation.phase === "restart-failed" || operation.phase === "recreate-failed") {
        markDone("fetching");
        setStatus("restarting", "error");
      } else {
        setStatus("fetching", "error");
      }
      return steps;
    }

    switch (operation.phase) {
      case "recreating":
      case "restarting":
        markDone("fetching");
        setStatus("restarting", "active");
        break;
      case "confirming":
        markDone("fetching", "restarting");
        setStatus("confirming", "active");
        break;
      case "complete":
        steps.forEach(s => { s.status = "done"; });
        break;
      case "validating":
      case "pulling":
      case "verifying":
      default:
        setStatus("fetching", "active");
        break;
    }

    return steps;
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
    setOperationStatus(null);
    setActionResult(null);
    setNextContainerId(null);
    stopPolling();
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
      setErrorMessage("Timed out waiting for confirmation. The action may have completed - check the dashboard.");
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

  async function applyOperationStatus(operation: OperationStatus) {
    setOperationStatus(operation);
    updateSteps(stepsFromUpdateOperation(operation));

    if (operation.status === "succeeded" || operation.status === "skipped") {
      stopPolling();
      setIsComplete(true);
      setActionResult(operation.result);
      const newDockerId = operation.result?.new_docker_id;
      if (typeof newDockerId === "string" && newDockerId && newDockerId !== container.docker_id) {
        setNextContainerId(newDockerId);
      }
      return;
    }

    if (operation.status === "failed") {
      stopPolling();
      setHasError(true);
      setErrorMessage(operation.error ?? "Update operation failed.");
    }
  }

  function startOperationPolling(operationId: string) {
    timeoutRef.current = setTimeout(() => {
      stopPolling();
      const activeStep = progressStepsRef.current.find(s => s.status === "active");
      if (activeStep) setStepStatus(activeStep.id, "error");
      setHasError(true);
      setErrorMessage("Timed out waiting for update operation status. The action may have completed - check the dashboard.");
    }, 120_000);

    const poll = async () => {
      try {
        const operation = await api.operations.get(operationId);
        await applyOperationStatus(operation);
      } catch {
        // ignore transient operation polling errors until timeout
      }
    };

    void poll();
    pollRef.current = setInterval(poll, 500);
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
    if (actionRef.current === "update-and-restart" && nextContainerId && nextContainerId !== container.docker_id) {
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      return;
    }
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

  const { mutate, isPending: mutationIsPending } = useMutation({
    mutationFn: (action: ActionType) => {
      if (action === "check-for-updates") return api.containers.checkForUpdates(container.docker_id);
      if (action === "update-and-restart") return api.containers.updateAndRestart(container.docker_id);
      // Not unsafe dynamic invocation: action is constrained by the ActionType union
      // ("stop" | "restart" | "start") — all known methods on api.containers.
      return api.containers[action](container.docker_id);
    },
    onMutate: (action: ActionType) => {
      setPendingAction(action);
      setOperationStatus(null);
      setActionResult(null);
      actionRef.current = action;
      initialDigestCheckRef.current = container.last_digest_check;
      initialStartedAtRef.current = container.started_at;
      const steps = STEP_DEFINITIONS[action].map(s => ({ ...s }));
      steps[0] = { ...steps[0], status: "active" };
      updateSteps(steps);
    },
    onSuccess: (data, action) => {
      setActionResult(data as Record<string, unknown>);
      if (action === "check-for-updates") {
        setStepStatus("checking", "done");
        setStepStatus("complete", "done");
        setIsComplete(true);
        queryClient.invalidateQueries({ queryKey: ["container", container.docker_id] });
        queryClient.invalidateQueries({ queryKey: ["containers"] });
        return;
      }
      if (action === "update-and-restart") {
        const result = data as unknown as { operation_id?: string };
        if (result.operation_id) {
          startOperationPolling(result.operation_id);
          return;
        }
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
    if (action === "check-for-updates") {
      mutate(action);
      return;
    }
    setPendingAction(action);
  }

  function confirmAction() {
    if (!pendingAction) return;
    mutate(pendingAction);
  }

  function closeModal() {
    const destinationId = nextContainerId;
    resetProgress();
    setPendingAction(null);
    if (destinationId && destinationId !== container.docker_id) {
      queryClient.invalidateQueries({ queryKey: ["container", destinationId] });
      queryClient.invalidateQueries({ queryKey: ["containers"] });
      navigate(`/containers/${destinationId}`, { replace: true });
    }
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
    "check-for-updates":  "border-slate-600 text-slate-400 hover:bg-surface-3 hover:border-slate-500",
    "update-and-restart": "border-blue-400 text-blue-400 hover:bg-blue-500/10",
  };

  const modalMessages: Record<ActionType, string> = {
    stop:                 `Are you sure you want to stop ${container.name}?`,
    restart:              `Are you sure you want to restart ${container.name}?`,
    start:                `Are you sure you want to start ${container.name}?`,
    "check-for-updates":  `Checking ${container.name} for image updates.`,
    "update-and-restart": `Update ${container.name} to the latest image and restart? The container will only restart if a new image is available.`,
  };

  function shortId(value: unknown): string | null {
    return typeof value === "string" && value ? value.slice(0, 12) : null;
  }

  function boolLabel(value: unknown): string | null {
    return typeof value === "boolean" ? (value ? "Yes" : "No") : null;
  }

  function isAlreadyCurrentResult(): boolean {
    return (
      pendingAction === "update-and-restart" &&
      isComplete &&
      (
        operationStatus?.status === "skipped" ||
        operationStatus?.phase === "already-current" ||
        actionResult?.restarted === false
      )
    );
  }

  function buildModalDetails(): Array<{ label: string; value: string; tone?: "default" | "success" | "warning" | "error" }> {
    const details: Array<{ label: string; value: string; tone?: "default" | "success" | "warning" | "error" }> = [
      { label: "Container", value: container.name },
      { label: "Action", value: pendingAction?.replace(/-/g, " ") ?? "Action" },
    ];

    if (operationStatus) {
      details.push(
        {
          label: "Status",
          value: operationStatus.status,
          tone: operationStatus.status === "failed" ? "error" : operationStatus.status === "running" ? "warning" : "success",
        },
        { label: "Phase", value: operationStatus.phase },
      );
    }

    if (isComplete && !operationStatus) {
      details.push({ label: "Status", value: "succeeded", tone: "success" });
    }

    const updateAvailable = boolLabel(actionResult?.update_available);
    if (updateAvailable) {
      if (pendingAction === "update-and-restart" && isComplete) {
        details.push({
          label: "Image current",
          value: actionResult?.update_available === false ? "Yes" : "No",
          tone: actionResult?.update_available === false ? "success" : "warning",
        });
      } else {
        details.push({
          label: "Update available",
          value: updateAvailable,
          tone: actionResult?.update_available === true ? "warning" : "success",
        });
      }
    }

    const restarted = boolLabel(actionResult?.restarted);
    if (restarted) details.push({ label: "Restarted", value: restarted, tone: actionResult?.restarted === true ? "success" : "default" });

    const newDockerId = shortId(actionResult?.new_docker_id);
    if (newDockerId) details.push({ label: "New ID", value: newDockerId });

    if (operationStatus?.completed_at) {
      details.push({ label: "Completed", value: formatDateTime(operationStatus.completed_at, tz) });
    }

    return details;
  }

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
          onCancel={closeModal}
          isPending={isPending}
          progressSteps={progressSteps}
          isComplete={isComplete}
          hasError={hasError}
          errorMessage={errorMessage ?? undefined}
          title={pendingAction === "check-for-updates" ? "Check for Updates" : pendingAction === "update-and-restart" ? "Update & Restart" : `${pendingAction[0].toUpperCase()}${pendingAction.slice(1)} Container`}
          details={buildModalDetails()}
          compactProgress
          completeLabel={isAlreadyCurrentResult() ? "Already current" : "Complete"}
        />
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {showRestart && (
            <button
              disabled={isPending}
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
              disabled={isPending}
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
              disabled={isPending}
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
            disabled={isPending}
            onClick={() => requestAction("check-for-updates")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_STYLES["check-for-updates"]}`}
          >
            {isPending && pendingAction === "check-for-updates" ? <Spinner /> : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            Check for Updates
          </button>
          {showUpdateAndRestart && (
            <button
              disabled={isPending}
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

  const dayBreaks = new Set(
    data.reduce<number[]>((acc, d, i) => {
      if (i === 0) return acc;
      const prev = new Date((data[i-1].recorded_at.endsWith("Z") ? data[i-1].recorded_at : data[i-1].recorded_at + "Z"));
      const curr = new Date((d.recorded_at.endsWith("Z") ? d.recorded_at : d.recorded_at + "Z"));
      if (curr.getDate() !== prev.getDate()) acc.push(i);
      return acc;
    }, [])
  );

  return (
    <div className="w-full px-4 outline-none">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 96, bottom: 8, left: 16 }}
          style={{ outline: "none" }}
        >
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="recorded_at"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(val: string, index: number) => {
              const ts = new Date(val.endsWith("Z") ? val : val + "Z");
              const time = ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
              if (dayBreaks.has(index)) {
                const date = ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                return `${date} ${time}`;
              }
              return time;
            }}
            interval="preserveStartEnd"
            minTickGap={32}
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

// ── CPU % chart ───────────────────────────────────────────────────────────────

interface CpuTooltipProps {
  active?: boolean;
  payload?: { value?: number; payload?: MetricsHistoryPoint }[];
}

function CpuTooltip({ active, payload }: CpuTooltipProps) {
  if (!active || !payload?.length) return null;
  const raw = payload[0].payload?.timestamp ?? "";
  const ts = new Date(raw.endsWith("Z") ? raw : raw + "Z");
  const date = ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const cpu = payload[0].value ?? 0;
  return (
    <div className="rounded border border-slate-700 bg-[#0f172a] px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span className="inline-block w-4 border-t-2 border-[#22d3ee]" />
        <span className="text-slate-300">{cpu.toFixed(2)}%</span>
      </div>
      <div className="text-slate-500 pt-0.5">{date}, {time}</div>
    </div>
  );
}

function CpuChart({ data }: { data: MetricsHistoryPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-slate-500 text-sm">
        No CPU history available yet
      </div>
    );
  }

  const dayBreaks = new Set(
    data.reduce<number[]>((acc, d, i) => {
      if (i === 0) return acc;
      const prev = new Date((data[i-1].timestamp.endsWith("Z") ? data[i-1].timestamp : data[i-1].timestamp + "Z"));
      const curr = new Date((d.timestamp.endsWith("Z") ? d.timestamp : d.timestamp + "Z"));
      if (curr.getDate() !== prev.getDate()) acc.push(i);
      return acc;
    }, [])
  );

  return (
    <div className="w-full px-4 outline-none">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 96, bottom: 8, left: 16 }}
          style={{ outline: "none" }}
        >
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(val: string, index: number) => {
              const ts = new Date(val.endsWith("Z") ? val : val + "Z");
              const time = ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
              if (dayBreaks.has(index)) {
                const date = ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                return `${date} ${time}`;
              }
              return time;
            }}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(v: number) => `${v}%`}
            width={40}
            ticks={[0, 25, 50, 75, 100]}
          />
          <Tooltip content={<CpuTooltip />} cursor={{ stroke: "#475569", strokeWidth: 1, strokeDasharray: "3 3" }} />
          <Line
            type="monotone"
            dataKey="cpu_percent"
            stroke="#22d3ee"
            strokeWidth={1.5}
            dot={data.length === 1 ? { r: 3, fill: "#22d3ee" } : false}
            activeDot={{ r: 3, fill: "#22d3ee" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Memory chart ──────────────────────────────────────────────────────────────

interface MemTooltipProps {
  active?: boolean;
  payload?: { value?: number; payload?: MetricsHistoryPoint }[];
}

function MemTooltip({ active, payload }: MemTooltipProps) {
  if (!active || !payload?.length) return null;
  const raw = payload[0].payload?.timestamp ?? "";
  const ts = new Date(raw.endsWith("Z") ? raw : raw + "Z");
  const date = ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const mem = payload[0].value ?? 0;
  const limit = payload[0].payload?.mem_limit_bytes ?? 0;
  return (
    <div className="rounded border border-slate-700 bg-[#0f172a] px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span className="inline-block w-4 border-t-2 border-[#a78bfa]" />
        <span className="text-slate-300">
          {formatBytes(mem)}{limit > 0 ? ` / ${formatBytes(limit)}` : ""}
        </span>
      </div>
      <div className="text-slate-500 pt-0.5">{date}, {time}</div>
    </div>
  );
}

function MemChart({ data }: { data: MetricsHistoryPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-slate-500 text-sm">
        No memory history available yet
      </div>
    );
  }

  const rawMax = Math.max(...data.map((d) => d.mem_usage_bytes), 1);
  const maxVal = tieredCeiling(rawMax);

  const dayBreaks = new Set(
    data.reduce<number[]>((acc, d, i) => {
      if (i === 0) return acc;
      const prev = new Date((data[i-1].timestamp.endsWith("Z") ? data[i-1].timestamp : data[i-1].timestamp + "Z"));
      const curr = new Date((d.timestamp.endsWith("Z") ? d.timestamp : d.timestamp + "Z"));
      if (curr.getDate() !== prev.getDate()) acc.push(i);
      return acc;
    }, [])
  );

  return (
    <div className="w-full px-4 outline-none">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 96, bottom: 8, left: 16 }}
          style={{ outline: "none" }}
        >
          <CartesianGrid stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(val: string, index: number) => {
              const ts = new Date(val.endsWith("Z") ? val : val + "Z");
              const time = ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
              if (dayBreaks.has(index)) {
                const date = ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                return `${date} ${time}`;
              }
              return time;
            }}
            interval="preserveStartEnd"
            minTickGap={32}
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
          <Tooltip content={<MemTooltip />} cursor={{ stroke: "#475569", strokeWidth: 1, strokeDasharray: "3 3" }} />
          <Line
            type="monotone"
            dataKey="mem_usage_bytes"
            stroke="#a78bfa"
            strokeWidth={1.5}
            dot={data.length === 1 ? { r: 3, fill: "#a78bfa" } : false}
            activeDot={{ r: 3, fill: "#a78bfa" }}
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
    <div className="grid gap-1 border-b border-border py-2 last:border-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3 xl:grid-cols-1 2xl:grid-cols-[6.5rem_minmax(0,1fr)]">
      <span className="text-xs uppercase text-slate-600 sm:text-sm sm:normal-case sm:text-slate-500">{label}</span>
      <span className="min-w-0 break-words font-mono text-sm text-slate-200">{value}</span>
    </div>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  subtext,
  icon,
  highlight = false,
  wrapValue = false,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  icon: React.ReactNode;
  highlight?: boolean;
  wrapValue?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase text-slate-500">{label}</span>
        <span className={`shrink-0 ${highlight ? "text-yellow-400" : "text-slate-600"}`}>{icon}</span>
      </div>
      <div className={`mt-2 min-w-0 font-mono text-base font-semibold leading-tight ${wrapValue ? "whitespace-normal break-words" : "truncate"} ${highlight ? "text-yellow-300" : "text-slate-100"}`}>
        {value}
      </div>
      {subtext && <div className="mt-1 truncate text-xs text-slate-500">{subtext}</div>}
    </div>
  );
}

function CompactOverview({
  container,
  isRunning,
  memoryPercent,
  uptimeLabel,
}: {
  container: Container;
  isRunning: boolean;
  memoryPercent: number;
  uptimeLabel: string;
}) {
  const items = [
    { label: "CPU", value: `${container.cpu_percent.toFixed(2)}%` },
    {
      label: "Memory",
      value: container.mem_limit > 0 ? `${memoryPercent.toFixed(0)}%` : formatBytes(container.mem_usage),
    },
    { label: "Uptime", value: isRunning ? uptimeLabel : "Not running" },
    { label: "Restarts", value: String(container.restart_count) },
    { label: "Network", value: latestNetworkTotal(container) },
  ];

  return (
    <section className="rounded-lg border border-border bg-surface-1 px-4 py-3">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <div className="text-xs uppercase text-slate-600">{item.label}</div>
            <div className="mt-1 truncate font-mono font-semibold text-slate-200">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DetailSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface-1 px-4">
      <h2 className="flex items-center gap-2 border-b border-border py-3 text-sm font-medium text-slate-300">
        <span className="text-slate-500">{icon}</span>
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function PillList({ items, empty = "None" }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <span className="text-slate-500">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="badge max-w-full break-all border border-border bg-surface-3 font-mono text-slate-300">
          {item}
        </span>
      ))}
    </div>
  );
}

function imageParts(image: string) {
  const slashIndex = image.lastIndexOf("/");
  const tagIndex = image.lastIndexOf(":");
  if (tagIndex > slashIndex) {
    return {
      repo: image.slice(0, tagIndex),
      tag: image.slice(tagIndex + 1),
    };
  }
  return { repo: image, tag: "latest" };
}

function sourceLabel(container: Container) {
  if (!container.compose_project) return "Standalone";
  return container.compose_service
    ? `${container.compose_project} / ${container.compose_service}`
    : container.compose_project;
}

function restartPolicyLabel(policy: string | null) {
  if (!policy || policy === "no") return "No auto-restart";
  return policy;
}

function healthTone(status: string | null) {
  if (status === "healthy") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (status === "unhealthy") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (status === "starting") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
  return "border-slate-700 bg-surface-3 text-slate-400";
}

function HealthBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${healthTone(status)}`}>
      <FiHeart className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function latestNetworkTotal(container: Container) {
  const rx = container.net_rx_bytes ?? 0;
  const tx = container.net_tx_bytes ?? 0;
  return rx > 0 || tx > 0 ? `${formatBytes(rx)} in / ${formatBytes(tx)} out` : "No traffic";
}

function NetworkStatValue({ container }: { container: Container }) {
  const rx = container.net_rx_bytes ?? 0;
  const tx = container.net_tx_bytes ?? 0;
  if (rx <= 0 && tx <= 0) return <>No traffic</>;

  return (
    <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
      <span className="whitespace-nowrap">{formatBytes(rx)} in</span>
      <span className="whitespace-nowrap">{formatBytes(tx)} out</span>
    </span>
  );
}

function AttentionBand({ container }: { container: Container }) {
  const items = [
    container.state !== "running" ? `Container is currently ${container.state}.` : null,
    container.health_status === "unhealthy" ? "Healthcheck is failing." : null,
    container.oom_killed ? "Last stop was OOM-killed." : null,
    container.container_error ? `Docker reported: ${container.container_error}` : null,
    container.update_available ? "A newer image is available." : null,
    container.restart_count > 0
      ? `${container.restart_count} restart${container.restart_count === 1 ? "" : "s"} recorded.`
      : null,
  ].filter(Boolean);

  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-yellow-100/80">
        <span className="inline-flex items-center gap-2 font-medium text-yellow-300">
          <FiAlertTriangle className="h-4 w-4" />
          Attention
        </span>
        {items.map((item) => (
          <span key={item} className="min-w-0">{item}</span>
        ))}
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContainerDetail() {
  const { id } = useParams<{ id: string }>();
  const tz = useTimezone();
  const { isAuthenticated } = useAuth();
  const [operationModalOpen, setOperationModalOpen] = useState(false);
  const [overviewCollapsed, setOverviewCollapsed] = useState(false);
  const logsRef = useRef<HTMLElement | null>(null);

  const { data: container, isLoading, isError } = useQuery<Container>({
    queryKey: ["container", id],
    queryFn: () => api.containers.get(id!),
    refetchInterval: (query) => {
      if (operationModalOpen) return false;
      const state = (query.state.data as Container | undefined)?.state;
      if (state && ["restarting", "created"].includes(state)) return 2_000;
      return 10_000;
    },
    enabled: !!id && isAuthenticated,
    retry: operationModalOpen ? false : 3,
  });

  const { data: networkHistory = [] } = useQuery<NetworkHistoryPoint[]>({
    queryKey: ["network-history", id],
    queryFn: () => api.containers.networkHistory(id!),
    enabled: !!id && isAuthenticated,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const { data: metricsHistory = [] } = useQuery<MetricsHistoryPoint[]>({
    queryKey: ["metrics-history", id],
    queryFn: () => api.containers.metricsHistory(id!),
    enabled: !!id && isAuthenticated,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  if (isLoading) {
    return <div className="text-center py-16 text-slate-500">Loading…</div>;
  }

  if (!container && isError) {
    return (
      <div className="text-center py-16">
        <p className="text-red-400 mb-4">Container not found.</p>
        <Link to="/" className="text-accent hover:text-accent-hover">← Back to dashboard</Link>
      </div>
    );
  }

  if (!container) {
    return <div className="text-center py-16 text-slate-500">Loading…</div>;
  }

  const imageInfo = imageParts(container.image);
  const isRunning = container.state === "running";
  const uptimeLabel = container.started_at && isRunning ? formatUptime(container.started_at) : "-";
  const memoryPercent = container.mem_limit > 0 ? (container.mem_usage / container.mem_limit) * 100 : 0;

  function scrollToLogs() {
    logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface-1">
        <div className="border-b border-border px-4 py-3">
          <Link to="/containers" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-300">
            <FiArrowLeft className="h-4 w-4" />
            Containers
          </Link>
        </div>

        <div className="grid gap-4 px-4 py-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="min-w-0 break-words text-2xl font-semibold text-slate-100">{container.name}</h1>
              <StatusBadge state={container.state} />
              <HealthBadge status={container.health_status} />
              {container.update_available && (
                <span className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-300">
                  <FiArrowUp className="h-3.5 w-3.5" />
                  Image update
                </span>
              )}
            </div>
            <div className="grid gap-2 text-sm text-slate-500 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
              <span className="font-mono text-slate-400">{container.short_id}</span>
              <span className="min-w-0 break-words font-mono text-slate-500">{container.image}</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>{sourceLabel(container)}</span>
              <span>{container.status}</span>
              <span>Last seen {formatDateTime(container.last_seen, tz)}</span>
            </div>
          </div>

          <div className="xl:max-w-[38rem]">
            <ActionButtons container={container} onModalOpenChange={setOperationModalOpen} />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setOverviewCollapsed((collapsed) => !collapsed)}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
              >
                {overviewCollapsed ? <FiChevronDown className="h-4 w-4" /> : <FiChevronUp className="h-4 w-4" />}
                {overviewCollapsed ? "Expand overview" : "Collapse overview"}
              </button>
              <button
                type="button"
                onClick={scrollToLogs}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-400/60 px-3 py-2 text-sm text-blue-300 transition-colors hover:border-blue-300 hover:bg-blue-500/10 hover:text-blue-200"
              >
                <FiFileText className="h-4 w-4" />
                Logs
              </button>
            </div>
          </div>
        </div>
      </section>

      {overviewCollapsed ? (
        <>
          <CompactOverview
            container={container}
            isRunning={isRunning}
            memoryPercent={memoryPercent}
            uptimeLabel={uptimeLabel}
          />
          <AttentionBand container={container} />
        </>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="CPU" value={`${container.cpu_percent.toFixed(2)}%`} subtext={isRunning ? "current usage" : "not running"} icon={<FiCpu className="h-4 w-4" />} />
            <StatTile
              label="Memory"
              value={
                container.mem_limit > 0
                  ? `${memoryPercent.toFixed(0)}%`
                  : formatBytes(container.mem_usage)
              }
              subtext={
                container.mem_limit > 0
                  ? `${formatBytes(container.mem_usage)} / ${formatBytes(container.mem_limit)}`
                  : "limit unknown"
              }
              icon={<FiDatabase className="h-4 w-4" />}
            />
            <StatTile label="Uptime" value={uptimeLabel} subtext={container.started_at ? `Started ${formatDateTime(container.started_at, tz)}` : "not started"} icon={<FiClock className="h-4 w-4" />} />
            <StatTile label="Restarts" value={container.restart_count} subtext={container.restart_count === 1 ? "recorded restart" : "recorded restarts"} icon={<FiRefreshCw className="h-4 w-4" />} highlight={container.restart_count > 0} />
            <StatTile label="Network" value={<NetworkStatValue container={container} />} subtext={container.networks.length > 0 ? container.networks.join(", ") : "no networks"} icon={<FiWifi className="h-4 w-4" />} wrapValue />
          </section>

          <AttentionBand container={container} />

          <section className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            <DetailSection title="Runtime" icon={<FiActivity className="h-4 w-4" />}>
              <InfoRow label="State" value={<StatusBadge state={container.state} />} />
              <InfoRow label="Status" value={container.status} />
              <InfoRow label="Created" value={container.created_at ? formatDateTime(container.created_at, tz) : "Unknown"} />
              <InfoRow label="Started" value={container.started_at ? formatDateTime(container.started_at, tz) : "Not running"} />
              {container.health_status && <InfoRow label="Health" value={<HealthBadge status={container.health_status} />} />}
              <InfoRow label="Restart policy" value={restartPolicyLabel(container.restart_policy)} />
              {!isRunning && container.exit_code !== null && <InfoRow label="Exit code" value={container.exit_code} />}
              {!isRunning && container.finished_at && <InfoRow label="Finished" value={formatDateTime(container.finished_at, tz)} />}
              {container.oom_killed && <InfoRow label="OOM killed" value="Yes" />}
              {container.container_error && <InfoRow label="Error" value={container.container_error} />}
              <InfoRow label="Last seen" value={formatDateTime(container.last_seen, tz)} />
              <InfoRow label="Restarts" value={container.restart_count} />
            </DetailSection>

            <DetailSection title="Source" icon={<FiBox className="h-4 w-4" />}>
              <InfoRow label="Container ID" value={container.short_id} />
              <InfoRow label="Source" value={sourceLabel(container)} />
              {container.compose_project && <InfoRow label="Project" value={container.compose_project} />}
              {container.compose_service && <InfoRow label="Service" value={container.compose_service} />}
              <InfoRow label="Image" value={imageInfo.repo} />
              <InfoRow label="Tag" value={imageInfo.tag} />
              <InfoRow label="Image size" value={container.image_size !== null ? formatBytes(container.image_size) : "Unknown"} />
              <InfoRow label="Last pulled" value={container.last_pulled ? formatDateTime(container.last_pulled, tz) : "Unknown"} />
              <InfoRow
                label="Update check"
                value={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{container.last_digest_check ? formatDateTime(container.last_digest_check, tz) : "Never checked"}</span>
                    {container.update_available && (
                      <span className="inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-xs font-medium text-blue-300">
                        <FiArrowUp className="h-3 w-3" />
                        Update available
                      </span>
                    )}
                  </span>
                }
              />
            </DetailSection>

            <DetailSection title="Connectivity" icon={<FiWifi className="h-4 w-4" />}>
              <InfoRow label="Ports" value={<PillList items={container.ports} />} />
              <InfoRow label="Networks" value={<PillList items={container.networks} />} />
              <InfoRow label="Traffic" value={latestNetworkTotal(container)} />
            </DetailSection>

            <DetailSection title="Storage" icon={<FiHardDrive className="h-4 w-4" />}>
              <InfoRow label="Volumes" value={<PillList items={container.volumes} empty="No volumes reported" />} />
            </DetailSection>
          </section>

          <section>
            <EventTimeline dockerId={container.docker_id} showHeader showContainerName={false} />
          </section>

          <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="card">
              <div className="space-y-2 px-4 pb-2 pt-3">
                <h2 className="text-sm font-medium text-slate-300">CPU</h2>
                <div className="flex gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <svg width="16" height="2" aria-hidden="true">
                      <line x1="0" y1="1" x2="16" y2="1" stroke="#22d3ee" strokeWidth="2" />
                    </svg>
                    CPU %
                  </span>
                </div>
              </div>
              <div className="pb-4">
                <CpuChart data={metricsHistory} />
              </div>
            </div>

            <div className="card">
              <div className="space-y-2 px-4 pb-2 pt-3">
                <h2 className="text-sm font-medium text-slate-300">Memory</h2>
                <div className="flex gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <svg width="16" height="2" aria-hidden="true">
                      <line x1="0" y1="1" x2="16" y2="1" stroke="#a78bfa" strokeWidth="2" />
                    </svg>
                    Memory
                  </span>
                </div>
              </div>
              <div className="pb-4">
                <MemChart data={metricsHistory} />
              </div>
            </div>

            <div className="card">
              <div className="space-y-2 px-4 pb-2 pt-3">
                <h2 className="text-sm font-medium text-slate-300">Network I/O</h2>
                <div className="flex gap-4 text-xs text-slate-400">
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
              </div>
              <div className="pb-4">
                <NetworkIOChart data={networkHistory} />
              </div>
            </div>
          </section>
        </>
      )}

      <section ref={logsRef} className="scroll-mt-6 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Logs</h2>
        <LogViewer dockerId={container.docker_id} />
      </section>
    </div>
  );
}
