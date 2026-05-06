import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { WizardStatus } from "../types";

export default function AnalyticsBanner() {
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
    <div className="mb-5 bg-surface-2 border border-border rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <p className="flex-1 text-sm text-slate-400">
        Help me know how many people are running Nestview. Sends a random install ID, version, and architecture - nothing identifying.
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
  );
}
