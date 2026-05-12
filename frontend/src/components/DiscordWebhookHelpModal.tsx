import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

const STEPS = [
  <>In Discord, right-click any channel and click <strong className="text-slate-200">Edit Channel</strong></>,
  <>Go to <strong className="text-slate-200">Integrations</strong> and click <strong className="text-slate-200">Webhooks</strong></>,
  <>Click <strong className="text-slate-200">New Webhook</strong>, give it a name, then click <strong className="text-slate-200">Copy Webhook URL</strong></>,
  <>Paste the URL into Nestview</>,
];

export default function DiscordWebhookHelpModal({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl w-full max-w-lg mx-4 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <h3 className="text-sm font-semibold text-slate-100">How to create a Discord webhook</h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          <img
            src="/discord-webhook-setup.gif"
            alt="Discord webhook setup walkthrough"
            className="w-full rounded-lg border border-border"
          />
          <ol className="space-y-2">
            {STEPS.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-400 leading-relaxed">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-surface-3 border border-border text-xs text-slate-300 flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
