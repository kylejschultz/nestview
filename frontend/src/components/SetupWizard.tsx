import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import WebhookField from "./WebhookField";

interface SetupWizardProps {
  onDone: () => void;
}

export default function SetupWizard({ onDone }: SetupWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Password step state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  // Check setup status on mount — skip password step if already set
  useEffect(() => {
    api.auth.setupStatus().then(({ setup_complete }) => {
      if (setup_complete) setStep(2);
    }).catch(() => {});
  }, []);

  // Escape closes the wizard on step 2 only (no skip on step 1)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && step === 2) handleSkip(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step]);

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

  function handleSkip() {
    dismiss();
  }

  async function handleSetPassword() {
    setPasswordError(null);
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setIsSubmittingPassword(true);
    try {
      const setupResult = await api.auth.setup(password);
      if (!setupResult.ok) {
        setPasswordError(setupResult.detail ?? "Failed to set password.");
        return;
      }
      await api.auth.login(password);
      setStep(2);
    } catch {
      setPasswordError("An unexpected error occurred.");
    } finally {
      setIsSubmittingPassword(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={step === 2 ? handleSkip : undefined}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl w-full max-w-md mx-4 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-5">
          {[1, 2].map((n) => (
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
              <h2 className="text-lg font-semibold text-slate-100">Secure your dashboard</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Create a password to protect Nestview. You'll use this to log in from any browser.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(null); }}
                  className="w-full px-3 py-2 text-sm bg-surface-3 border border-border rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent"
                  placeholder="Min. 8 characters"
                  disabled={isSubmittingPassword}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                  className="w-full px-3 py-2 text-sm bg-surface-3 border border-border rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent"
                  placeholder="Re-enter password"
                  disabled={isSubmittingPassword}
                />
              </div>
              {passwordError && <p className="text-xs text-red-400">{passwordError}</p>}
            </div>
            <div className="pt-2">
              <button
                disabled={isSubmittingPassword}
                onClick={handleSetPassword}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmittingPassword ? "Setting up…" : "Set password & continue"}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
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
                onClick={handleSkip}
                className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >
                Skip for now
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
