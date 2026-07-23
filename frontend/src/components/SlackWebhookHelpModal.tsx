import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

const STEPS = [
  <>Go to <strong className="text-slate-200">api.slack.com/apps</strong> and create or open a Slack app for your workspace.</>,
  <>In the app settings, open <strong className="text-slate-200">Incoming Webhooks</strong>.</>,
  <>Toggle <strong className="text-slate-200">Activate Incoming Webhooks</strong> on.</>,
  <>Click <strong className="text-slate-200">Add New Webhook to Workspace</strong>.</>,
  <>Pick the channel Nestview should post to, then click <strong className="text-slate-200">Allow</strong>.</>,
  <>Copy the generated <strong className="text-slate-200">https://hooks.slack.com/services/...</strong> URL and paste it into Nestview.</>,
];

export default function SlackWebhookHelpModal({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl w-full max-w-lg mx-4 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <h3 className="text-sm font-semibold text-slate-100">How to create a Slack webhook</h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
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
          <p className="text-xs text-slate-500 leading-relaxed">
            Slack webhook URLs are channel-specific secrets. Keep the URL private and create one webhook per channel you want Nestview to notify.
          </p>
        </div>
      </div>
    </div>
  );
}
