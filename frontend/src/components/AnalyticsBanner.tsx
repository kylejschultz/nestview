import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { WizardStatus } from "../types";

function AnalyticsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl p-6 w-full max-w-sm mx-4 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-slate-200">What gets collected</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          When analytics are enabled, Nestview sends one ping per day containing only:
        </p>
        <ul className="space-y-1.5 text-sm text-slate-400">
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5 shrink-0">-</span>
            <span>A random install ID generated on first run (never tied to a user or account)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5 shrink-0">-</span>
            <span>Nestview version number</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5 shrink-0">-</span>
            <span>System architecture (e.g. arm64, amd64)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5 shrink-0">-</span>
            <span>Timestamp of the ping</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5 shrink-0">-</span>
            <span>Build channel (e.g. stable, dev)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5 shrink-0">-</span>
            <span>Number of containers currently tracked (a count, not names or images)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-0.5 shrink-0">-</span>
            <span>Host operating system type (e.g. Linux, Darwin)</span>
          </li>
        </ul>
        <p className="text-sm text-slate-500 leading-relaxed">
          No personal information, container names, image names, host data, or IP addresses are ever collected.
        </p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsBanner() {
  const [showModal, setShowModal] = useState(false);
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const { data: wizardStatus } = useQuery<WizardStatus>({
    queryKey: ["wizard-status"],
    queryFn: api.settings.wizard,
    staleTime: Infinity,
    enabled: isAuthenticated,
  });

  const { data: allSettings } = useQuery<Record<string, string>>({
    queryKey: ["settings-all"],
    queryFn: api.settings.getAll,
    enabled: isAuthenticated && wizardStatus?.completed === true,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  async function markSeen() {
    await api.settings.save({ analytics_prompt_seen: "true" });
    queryClient.invalidateQueries({ queryKey: ["settings-all"] });
  }

  const { mutate: dismiss, isPending: isDismissing } = useMutation({
    mutationFn: markSeen,
  });

  const { mutate: optIn, isPending: isOptingIn } = useMutation({
    mutationFn: async () => {
      await api.analytics.optIn();
      await markSeen();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics-status"] });
    },
  });

  const show =
    isAuthenticated &&
    wizardStatus?.completed === true &&
    allSettings?.["analytics_enabled"] !== "true" &&
    allSettings?.["analytics_prompt_seen"] !== "true";

  if (!show) return null;

  const isPending = isDismissing || isOptingIn;

  return (
    <>
      {showModal && <AnalyticsModal onClose={() => setShowModal(false)} />}
    <div className="mb-5 bg-surface-2 border border-border rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <p className="flex-1 text-sm text-slate-400">
        Help me know how many people are running Nestview. Sends a random install ID, version, and architecture - nothing identifying.{" "}
        <button
          onClick={() => setShowModal(true)}
          className="text-accent hover:text-accent-hover underline underline-offset-2 transition-colors"
        >
          Learn more
        </button>
      </p>
      <div className="flex gap-2 shrink-0">
        <button
          disabled={isPending}
          onClick={() => dismiss()}
          className="flex-1 sm:flex-none px-4 py-1.5 text-sm rounded-lg border border-border text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Skip
        </button>
        <button
          disabled={isPending}
          onClick={() => optIn()}
          className="flex-1 sm:flex-none px-4 py-1.5 text-sm rounded-lg border border-border text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isOptingIn ? "Saving..." : "Opt in"}
        </button>
      </div>
    </div>
    </>
  );
}
