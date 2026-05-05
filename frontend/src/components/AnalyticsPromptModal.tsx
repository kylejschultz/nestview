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
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-100">Anonymous Telemetry</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Help us understand how many active Nestview installs there are. This is
              opt-in — the default is off and you can change it any time in Settings.
            </p>
          </div>

          <div className="rounded-lg bg-surface-3 border border-border p-3 space-y-2">
            <p className="text-slate-300 font-medium text-xs uppercase tracking-wide">What's sent (nothing else)</p>
            <ul className="text-slate-400 space-y-1 text-sm">
              <li>· A random install ID — generated once, never tied to your identity</li>
              <li>· Nestview version</li>
              <li>· CPU architecture (amd64 or arm64)</li>
              <li>· A daily timestamp</li>
            </ul>
            <p className="text-slate-500 text-xs pt-1 border-t border-border mt-2">
              No hostnames, container names, IP addresses, or identifying information is ever sent.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              disabled={isPending}
              onClick={() => dismiss()}
              className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Dismiss
            </button>
            <button
              disabled={isPending}
              onClick={() => optIn()}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isOptingIn ? "Saving…" : "Opt in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
