import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AlertEventType, AlertSetting, Container } from "../types";

// ── Toggle component ──────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}

function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <label className="flex flex-col items-center gap-1.5 cursor-pointer select-none">
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          checked ? "bg-accent" : "bg-surface-3"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
      <span className={`text-xs ${checked ? "text-slate-300" : "text-slate-600"}`}>{label}</span>
    </label>
  );
}

// ── Alert settings helpers ────────────────────────────────────────────────────

const ALERT_TYPES: { key: AlertEventType; label: string }[] = [
  { key: "crash", label: "Crash" },
  { key: "restart", label: "Restart" },
  { key: "oom", label: "OOM Kill" },
];

function buildDisabledSet(settings: AlertSetting[]): Set<string> {
  const s = new Set<string>();
  for (const row of settings) {
    if (!row.enabled) s.add(`${row.container_name}:${row.event_type}`);
  }
  return s;
}

// ── Per-container row ─────────────────────────────────────────────────────────

interface ContainerRowProps {
  container: Container;
  disabledSet: Set<string>;
  onToggle: (container_name: string, event_type: AlertEventType, enabled: boolean) => void;
  isPending: boolean;
}

function ContainerRow({ container: c, disabledSet, onToggle, isPending }: ContainerRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{c.name}</p>
        <p className="text-xs text-slate-500 font-mono truncate mt-0.5">{c.image}</p>
      </div>
      <div className="flex items-center gap-5 shrink-0">
        {ALERT_TYPES.map(({ key, label }) => (
          <Toggle
            key={key}
            label={label}
            checked={!disabledSet.has(`${c.name}:${key}`)}
            disabled={isPending}
            onChange={(enabled) => onToggle(c.name, key, enabled)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: containers = [], isLoading: loadingContainers } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
  });

  const { data: alertSettings = [], isLoading: loadingSettings } = useQuery<AlertSetting[]>({
    queryKey: ["alert-settings"],
    queryFn: api.settings.alerts,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: ({
      container_name,
      event_type,
      enabled,
    }: {
      container_name: string;
      event_type: AlertEventType;
      enabled: boolean;
    }) => api.settings.setAlert(container_name, event_type, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-settings"] });
    },
  });

  const isLoading = loadingContainers || loadingSettings;
  const disabledSet = buildDisabledSet(alertSettings);

  // Group containers by compose project (same structure as dashboard)
  const groups: Record<string, Container[]> = {};
  const ungrouped: Container[] = [];
  for (const c of containers) {
    if (c.compose_project) {
      (groups[c.compose_project] ??= []).push(c);
    } else {
      ungrouped.push(c);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Alert Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Control which Discord notifications fire per container. Toggles take effect immediately.
          Containers with all alerts off will still be tracked — only Discord messages are suppressed.
        </p>
      </div>

      {/* Column labels */}
      {!isLoading && containers.length > 0 && (
        <div className="flex items-center justify-end gap-5 pr-0.5">
          {ALERT_TYPES.map(({ key, label }) => (
            <span key={key} className="w-9 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
              {label}
            </span>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="text-center py-16 text-slate-500">Loading…</div>
      )}

      {!isLoading && containers.length === 0 && (
        <div className="card p-6 text-center text-slate-500">
          No containers found. Is the collector running?
        </div>
      )}

      {/* Compose groups */}
      {Object.entries(groups).map(([project, members]) => (
        <section key={project} className="card">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              {project}
            </span>
          </div>
          <div className="px-4">
            {members.map((c) => (
              <ContainerRow
                key={c.docker_id}
                container={c}
                disabledSet={disabledSet}
                onToggle={(name, type, enabled) => mutate({ container_name: name, event_type: type, enabled })}
                isPending={isPending}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Standalone containers */}
      {ungrouped.length > 0 && (
        <section className="card">
          {Object.keys(groups).length > 0 && (
            <div className="px-4 py-3 border-b border-border">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Standalone</span>
            </div>
          )}
          <div className="px-4">
            {ungrouped.map((c) => (
              <ContainerRow
                key={c.docker_id}
                container={c}
                disabledSet={disabledSet}
                onToggle={(name, type, enabled) => mutate({ container_name: name, event_type: type, enabled })}
                isPending={isPending}
              />
            ))}
          </div>
        </section>
      )}

      {/* Hint when Discord is not configured */}
      <p className="text-xs text-slate-600">
        Settings are only meaningful when a Discord webhook URL is configured. Events are always recorded in the timeline regardless.
      </p>
    </div>
  );
}
