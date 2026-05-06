import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

interface Props {
  onClose: () => void;
}

export default function AnalyticsPromptModal({ onClose }: Props) {
  const queryClient = useQueryClient();

  async function markSeen() {
    await api.settings.save({ analytics_prompt_seen: "true" });
    queryClient.invalidateQueries({ queryKey: ["settings-all"] });
  }

  const { mutate: dismiss, isPending: isDismissing } = useMutation({
    mutationFn: markSeen,
    onSuccess: onClose,
  });

  const { mutate: optIn, isPending: isOptingIn } = useMutation({
    mutationFn: async () => {
      await api.analytics.optIn();
      await markSeen();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics-status"] });
      onClose();
    },
  });

  const isPending = isDismissing || isOptingIn;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !isPending && dismiss()}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl w-full max-w-md mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-slate-300 leading-relaxed">
              Want to help me know how many people are running Nestview? If you opt in, Nestview sends a small anonymous ping once a day.
            </p>
            <p className="text-sm text-slate-400 leading-relaxed">
              What's sent: a random install ID (never tied to you), your Nestview version, CPU architecture, and a timestamp.
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              No hostnames, container names, IPs, or anything identifying. You can change this any time in Settings.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              disabled={isPending}
              onClick={() => dismiss()}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Skip
            </button>
            <button
              disabled={isPending}
              onClick={() => optIn()}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isOptingIn ? "Saving..." : "Opt in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
