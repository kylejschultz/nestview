interface Props {
  state: string;
  className?: string;
}

const STATE_STYLES: Record<string, string> = {
  running: "bg-green-500/15 text-green-400 border border-green-500/30",
  restarting: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
  paused: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  exited: "bg-red-500/15 text-red-400 border border-red-500/30",
  dead: "bg-red-500/15 text-red-400 border border-red-500/30",
  created: "bg-slate-500/15 text-slate-400 border border-slate-500/30",
};

const DOT_STYLES: Record<string, string> = {
  running: "bg-green-400",
  restarting: "bg-yellow-400 animate-pulse",
  paused: "bg-blue-400",
  exited: "bg-red-400",
  dead: "bg-red-400",
  created: "bg-slate-400",
};

export default function StatusBadge({ state, className = "" }: Props) {
  const style = STATE_STYLES[state] ?? "bg-slate-500/15 text-slate-400 border border-slate-500/30";
  const dot = DOT_STYLES[state] ?? "bg-slate-400";

  return (
    <span className={`badge ${style} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {state}
    </span>
  );
}
