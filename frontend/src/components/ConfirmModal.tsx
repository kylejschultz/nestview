import { useEffect } from "react";

interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
}

export default function ConfirmModal({ message, onConfirm, onCancel, isPending }: ConfirmModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !isPending) onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, isPending]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={isPending ? undefined : onCancel}
    >
      <div
        className="bg-surface-2 border border-border rounded-xl p-6 w-full max-w-sm mx-4 space-y-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-slate-200 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            disabled={isPending}
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            disabled={isPending}
            onClick={onConfirm}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isPending && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
