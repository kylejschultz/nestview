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
  title?: string;
  details?: Array<{ label: string; value: string; tone?: "default" | "success" | "warning" | "error" }>;
  compactProgress?: boolean;
  completeLabel?: string;
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
  const nonHeaders = steps.filter((s) => !s.id.startsWith("header-"));
  const active = nonHeaders.find((s) => s.status === "active");
  if (active) return active.label;
  const lastDone = [...nonHeaders].reverse().find((s) => s.status === "done");
  if (lastDone) return lastDone.label;
  return "Working\u2026";
}

function detailToneClass(tone: "default" | "success" | "warning" | "error" = "default"): string {
  switch (tone) {
    case "success": return "text-green-300";
    case "warning": return "text-yellow-300";
    case "error":   return "text-red-300";
    default:        return "text-slate-200";
  }
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
  title,
  details,
  compactProgress,
  completeLabel = "Complete",
}: ConfirmModalProps) {
  // Escape key — blocked while in progress
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, isPending]);

  const showProgress = isPending && progressSteps && progressSteps.length > 0;
  const showDetails = details && details.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={isPending ? undefined : onCancel}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl p-6 w-full max-w-md min-w-80 mx-4 space-y-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-100">{title}</p>
            {(isComplete || hasError) && (
              <p className={`text-xs ${hasError ? "text-red-400" : "text-green-400"}`}>
                {hasError ? "Action failed" : completeLabel}
              </p>
            )}
          </div>
        )}

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
            {showProgress && compactProgress && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-1/60 p-3">
                <span className={hasError ? "text-red-400" : isComplete ? "text-green-400" : "text-slate-200"}>
                  <StepIcon status={hasError ? "error" : isComplete ? "done" : "active"} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">
                    {hasError ? "Action failed" : isComplete ? completeLabel : "Working..."}
                  </p>
                  {!hasError && !isComplete && (
                    <p className="text-xs text-slate-500 truncate">{progressTitle(progressSteps!)}</p>
                  )}
                </div>
              </div>
            )}

            {showProgress && !compactProgress && (
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                {progressTitle(progressSteps!)}
              </p>
            )}

            {showProgress && !compactProgress && (
              <div className="max-h-[60vh] overflow-y-auto">
                <ul className="space-y-2">
                  {progressSteps!.map((step) =>
                    step.id.startsWith("header-") ? (
                      <li key={step.id} className="pt-1 first:pt-0">
                        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                          {step.label}
                        </span>
                      </li>
                    ) : (
                      <li
                        key={step.id}
                        className={`flex items-center gap-2 text-sm transition-colors pl-2 ${stepColorClass(step.status)}`}
                      >
                        <StepIcon status={step.status} />
                        <span>{step.label}</span>
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}

            {showDetails && (
              <dl className="grid grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] gap-x-3 gap-y-2 rounded-lg border border-border bg-surface-1/60 p-3 text-xs">
                {details!.map((detail) => (
                  <div key={detail.label} className="contents">
                    <dt className="text-slate-500">{detail.label}</dt>
                    <dd className={`min-w-0 break-words font-medium ${detailToneClass(detail.tone)}`}>
                      {detail.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {/* Error message */}
            {hasError && errorMessage && (
              <p className="text-xs text-red-400 leading-relaxed">{errorMessage}</p>
            )}

            {(hasError || isComplete) && (
              <div className="flex justify-end">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                >
                  {isComplete && !hasError ? "Done" : "Close"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
