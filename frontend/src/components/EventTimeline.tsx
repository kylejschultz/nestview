import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { ContainerEvent } from "../types";
import { formatDateTime } from "../utils";
import { useTimezone } from "../TimezoneContext";

interface Props {
  dockerId?: string;
  limit?: number;
  showHeader?: boolean;
}

const EVENT_STYLES: Record<string, { dot: string; label: string }> = {
  start: { dot: "bg-green-500", label: "Started" },
  stop: { dot: "bg-slate-500", label: "Stopped" },
  die: { dot: "bg-red-500", label: "Stopped" },
  crash: { dot: "bg-red-500", label: "Crashed" },
  kill: { dot: "bg-orange-500", label: "Killed" },
  oom: { dot: "bg-purple-500", label: "OOM Killed" },
  restart: { dot: "bg-yellow-500", label: "Restarted" },
};

function stripContainerIds(details: string): string {
  return details.replace(/:\s*[0-9a-f]{12}(\s*→\s*[0-9a-f]{12})?/gi, "").trim();
}

function EventRow({ event, tz }: { event: ContainerEvent; tz: string }) {
  const style = EVENT_STYLES[event.event_type] ?? { dot: "bg-slate-400", label: event.event_type };
  const details = event.details ? stripContainerIds(event.details) : null;
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-1.5 flex-shrink-0 relative">
        <span className={`block w-2 h-2 rounded-full ${style.dot}`} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-300">
          <span className="font-medium">{event.container_name}</span>
          {" · "}
          <span className="text-slate-400">{style.label}</span>
          {details && (
            <span className="ml-1 text-xs text-slate-500 font-mono">({details})</span>
          )}
          {event.alerted && (
            <span className="ml-2 badge bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">notified</span>
          )}
        </p>
        <p className="text-xs text-slate-600 mt-0.5">
          {formatDateTime(event.timestamp, tz)}
        </p>
      </div>
    </div>
  );
}

export default function EventTimeline({ dockerId, limit = 30, showHeader = false }: Props) {
  const tz = useTimezone();
  const { isAuthenticated } = useAuth();
  const { data: events = [] } = useQuery<ContainerEvent[]>({
    queryKey: ["events", dockerId, limit],
    queryFn: () => api.events.list(dockerId, limit),
    refetchInterval: 15_000,
    enabled: isAuthenticated,
  });

  if (showHeader) {
    return (
      <div className="card px-4">
        <h2 className="text-sm font-medium text-slate-300 py-3">Events</h2>
        {events.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">No events recorded yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {events.map((e) => (
              <EventRow key={e.id} event={e} tz={tz} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="card px-4 py-6 text-center text-sm text-slate-500">
        No events recorded yet.
      </div>
    );
  }

  return (
    <div className="card px-4 divide-y divide-border">
      {events.map((e) => (
        <EventRow key={e.id} event={e} tz={tz} />
      ))}
    </div>
  );
}
