import React, { useEffect, useRef, useState } from "react";

interface InfoPopoverProps {
  content: string;
}

export default function InfoPopover({ content }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold leading-none text-slate-500 border border-slate-600 hover:border-slate-400 hover:text-slate-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        aria-label="More information"
      >
        ?
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-50 w-64 rounded-lg bg-surface-2 border border-border shadow-lg p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-slate-300 leading-relaxed flex-1">{content}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors text-sm leading-none mt-0.5 focus:outline-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
