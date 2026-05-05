import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import WebhookField from "./WebhookField";

interface SetupWizardProps {
  onDone: () => void;
}

export default function SetupWizard({ onDone }: SetupWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleSkip(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { mutate: dismiss } = useMutation({
    mutationFn: api.settings.dismissWizard,
    onSuccess: () => onDone(),
  });

  const { mutate: saveAndFinish, isPending: isSaving } = useMutation({
    mutationFn: () => api.settings.saveGeneral({ discord_webhook_url: webhookUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-general"] });
      dismiss();
    },
    onError: (err: Error) => {
      setSaveError(err.message);
    },
  });

  const { mutate: analyticsOptIn, isPending: isOptingIn } = useMutation({
    mutationFn: api.analytics.optIn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics-status"] });
      queryClient.invalidateQueries({ queryKey: ["settings-all"] });
      setStep(3);
    },
  });

  function handleSkip() {
    dismiss();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleSkip}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl w-full max-w-md mx-4 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-5">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`w-2 h-2 rounded-full transition-colors ${
                step >= n ? "bg-accent" : "bg-surface-3"
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-100">Welcome to Nestview</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Your Docker containers are now being tracked. Optionally, set up Discord
                alerts to be notified when containers crash, restart, or get OOM-killed.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => setStep(2)}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
              >
                Set up Discord alerts
              </button>
              <button
                onClick={handleSkip}
                className="w-full px-4 py-2.5 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-100">Anonymous Telemetry</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Help us understand how many active Nestview installs there are. This is
                opt-in — the default is off and you can change it any time in Settings.
              </p>
            </div>
            <div className="rounded-lg bg-surface-3 border border-border p-3 space-y-2 text-sm">
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
                onClick={() => setStep(1)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >
                Skip
              </button>
              <button
                disabled={isOptingIn}
                onClick={() => analyticsOptIn()}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isOptingIn ? "Saving…" : "Opt in"}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-100">Set up Discord alerts</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Paste an incoming webhook URL from your Discord server settings. You can
                test it before saving.
              </p>
            </div>
            <WebhookField
              value={webhookUrl}
              onChange={(v) => { setWebhookUrl(v); setSaveError(null); }}
              disabled={isSaving}
            />
            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >
                Back
              </button>
              <button
                disabled={isSaving || !webhookUrl}
                onClick={() => saveAndFinish()}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving…" : "Save & finish"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
