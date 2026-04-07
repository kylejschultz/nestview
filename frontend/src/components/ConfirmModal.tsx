import { useEffect } from "react";

export interface ProgressStep {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
}

interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
  progressSteps?: ProgressStep[];
  isComplete?: boolean;
  hasError?: boolean;
  errorMessage?: string;
}

function StepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "active") {
    return (
      <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    );
  }
  if (status === "done") {
    return <span className="w-3.5 text-center shrink-0 leading-none">✓</span>;
  }
  if (status === "error") {
    return <span className="w-3.5 text-center shrink-0 leading-none">✗</span>;
  }
  // pending — spacer to keep alignment
  return <span className="w-3.5 shrink-0" />;
}

function stepColorClass(status: ProgressStep["status"]): string {
  switch (status) {
    case "active":  return "text-slate-200";
    case "done":    return "text-green-400";
    case "error":   return "text-red-400";
    default:        return "text-slate-600";
  }
}

function progressTitle(steps: ProgressStep[]): string {
  const active = steps.find((s) => s.status === "active");
  if (active) return active.label;
  const lastDone = [...steps].reverse().find((s) => s.status === "done");
  if (lastDone) return lastDone.label;
  return "Working\u2026";
}

export default function ConfirmModal({
  message,
  onConfirm,
  onCancel,
  isPending,
  progressSteps,
  isComplete,
  hasError,
  errorMessage,
}: ConfirmModalProps) {
  // Escape key — blocked while in progress
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, isPending]);

  // Auto-close after completion
  useEffect(() => {
    if (!isComplete) return;
    const timer = setTimeout(onCancel, 1500);
    return () => clearTimeout(timer);
  }, [isComplete, onCancel]);

  const showProgress = isPending && progressSteps && progressSteps.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={isPending ? undefined : onCancel}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl p-6 w-full max-w-sm min-w-80 mx-4 space-y-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* State 1: confirming */}
        {!isPending && (
          <>
            <p className="text-sm text-slate-200 leading-relaxed">{message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
              >
                Confirm
              </button>
            </div>
          </>
        )}

        {/* States 2–4: in progress / complete / error */}
        {isPending && (
          <>
            {showProgress && (
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                {progressTitle(progressSteps!)}
              </p>
            )}

            {showProgress && (
              <ul className="space-y-2">
                {progressSteps!.map((step) => (
                  <li
                    key={step.id}
                    className={`flex items-center gap-2 text-sm transition-colors ${stepColorClass(step.status)}`}
                  >
                    <StepIcon status={step.status} />
                    <span>{step.label}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Error message */}
            {hasError && errorMessage && (
              <p className="text-xs text-red-400 leading-relaxed">{errorMessage}</p>
            )}

            {/* Error close button */}
            {hasError && (
              <div className="flex justify-end">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
