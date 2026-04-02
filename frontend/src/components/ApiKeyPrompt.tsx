import { useEffect, useRef, useState } from "react";
import { setApiKey } from "../api";

interface ApiKeyPromptProps {
  onUnlocked: () => void;
}

export default function ApiKeyPrompt({ onUnlocked }: ApiKeyPromptProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("API key cannot be empty");
      return;
    }
    setApiKey(trimmed);
    onUnlocked();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-surface-2 border border-border rounded-xl w-full max-w-sm mx-4 shadow-xl p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-100">API key required</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            This Nestview instance is protected. Enter the <code className="text-slate-300 bg-surface-3 px-1 rounded text-xs">NESTVIEW_API_KEY</code> configured in your <code className="text-slate-300 bg-surface-3 px-1 rounded text-xs">.env</code> file.
          </p>
        </div>
        <input
          ref={inputRef}
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
          placeholder="Paste your API key"
          className="w-full px-3 py-2 text-sm rounded-lg bg-surface-3 border border-border text-slate-100 placeholder-slate-500 focus:outline-none focus:border-accent"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          onClick={handleSubmit}
          className="w-full px-4 py-2.5 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
