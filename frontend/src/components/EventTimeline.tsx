import { useState } from "react";
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
  showContainerName?: boolean;
}

const EVENT_DOT: Record<string, string> = {
  start:   "bg-green-500",
  stop:    "bg-slate-500",
  die:     "bg-red-500",
  crash:   "bg-red-500",
  kill:    "bg-orange-500",
  oom:     "bg-purple-500",
  restart: "bg-yellow-500",
};

const EVENT_LABELS: Record<string, string> = {
  start:     "Container Started",
  stop:      "Container Stopped",
  kill:      "Container Killed",
  crash:     "Container Crashed",
  die:       "Container Exited",
  restart:   "Container Restarted",
  oom:       "Container OOM",
  recreated: "Container Recreated",
};

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? `Container ${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

const PAGE_SIZE = 8;

function EventRow({ event, tz, showContainerName }: { event: ContainerEvent; tz: string; showContainerName: boolean }) {
  const dot = EVENT_DOT[event.event_type] ?? "bg-slate-400";
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-1.5 flex-shrink-0">
        <span className={`block w-2 h-2 rounded-full ${dot}`} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-slate-300">
          {showContainerName && (
            <>
              <span className="font-medium">{event.container_name}</span>
              {" - "}
            </>
          )}
          <span className="text-slate-400">{eventLabel(event.event_type)}</span>
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

function Pagination({ page, total, onPrev, onNext }: { page: number; total: number; onPrev: () => void; onNext: () => void }) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-2 pb-1">
      <button
        onClick={onPrev}
        disabled={page === 1}
        className="px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Prev
      </button>
      <span className="text-xs text-slate-500">{page} / {totalPages}</span>
      <button
        onClick={onNext}
        disabled={page === totalPages}
        className="px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Next
      </button>
    </div>
  );
}

export default function EventTimeline({ dockerId, limit = 30, showHeader = false, showContainerName = true }: Props) {
  const tz = useTimezone();
  const { isAuthenticated } = useAuth();
  const [page, setPage] = useState(1);

  const { data: events = [] } = useQuery<ContainerEvent[]>({
    queryKey: ["events", dockerId, limit],
    queryFn: () => api.events.list(dockerId, limit),
    refetchInterval: 15_000,
    enabled: isAuthenticated,
  });

  const totalPages = Math.ceil(events.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages, 1));
  const visible = events.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handlePrev() { setPage((p) => Math.max(p - 1, 1)); }
  function handleNext() { setPage((p) => Math.min(p + 1, totalPages)); }

  if (showHeader) {
    return (
      <div className="card px-4">
        <h2 className="text-sm font-medium text-slate-300 py-3">Events</h2>
        {events.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">No events recorded yet.</div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {visible.map((e) => (
                <EventRow key={e.id} event={e} tz={tz} showContainerName={showContainerName} />
              ))}
            </div>
            <Pagination page={safePage} total={events.length} onPrev={handlePrev} onNext={handleNext} />
          </>
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
    <div className="card px-4">
      <div className="divide-y divide-border">
        {visible.map((e) => (
          <EventRow key={e.id} event={e} tz={tz} showContainerName={showContainerName} />
        ))}
      </div>
      <Pagination page={safePage} total={events.length} onPrev={handlePrev} onNext={handleNext} />
    </div>
  );
}
