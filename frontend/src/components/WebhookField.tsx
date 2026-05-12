import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import DiscordWebhookHelpModal from "./DiscordWebhookHelpModal";

interface WebhookFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onTestSuccess?: () => void;
  onTestError?: (msg: string) => void;
}

export default function WebhookField({ value, onChange, disabled, onTestSuccess, onTestError }: WebhookFieldProps) {
  const [testStatus, setTestStatus] = useState<"idle" | "ok" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string>("");
  const [showHelp, setShowHelp] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleReset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTestStatus("idle"), 5_000);
  }

  const { mutate: runTest, isPending: isTesting } = useMutation({
    mutationFn: () => api.settings.testWebhook(value),
    onSuccess: (data) => {
      if (data.ok) {
        if (onTestSuccess) {
          onTestSuccess();
        } else {
          setTestStatus("ok");
          setTestMessage("Test message sent.");
          scheduleReset();
        }
      } else {
        const msg = data.error ?? "Test failed.";
        if (onTestError) {
          onTestError(msg);
        } else {
          setTestStatus("error");
          setTestMessage(msg);
          scheduleReset();
        }
      }
    },
    onError: (err: Error) => {
      if (onTestError) {
        onTestError(err.message);
      } else {
        setTestStatus("error");
        setTestMessage(err.message);
        scheduleReset();
      }
    },
  });

  return (
    <div className="space-y-2">
      {showHelp && <DiscordWebhookHelpModal onClose={() => setShowHelp(false)} />}
      <div className="flex gap-2">
        <input
          type="url"
          value={value}
          onChange={(e) => { onChange(e.target.value); setTestStatus("idle"); }}
          disabled={disabled}
          placeholder="https://discord.com/webhooks/…"
          className="flex-1 bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled || isTesting || !value}
          onClick={() => runTest()}
          className="px-3 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {isTesting ? "Sending…" : "Test"}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setShowHelp(true)}
        className="text-xs text-slate-500 hover:text-accent transition-colors"
      >
        How do I get this?
      </button>
      {testStatus === "ok" && (
        <p className="text-xs text-green-400">{testMessage}</p>
      )}
      {testStatus === "error" && (
        <p className="text-xs text-red-400">{testMessage}</p>
      )}
    </div>
  );
}
