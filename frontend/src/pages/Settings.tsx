import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AlertEventType, AlertSetting, Container, GeneralSettings } from "../types";
import WebhookField from "../components/WebhookField";
import TimezoneSelect from "../components/TimezoneSelect";

// ── Toggle ────────────────────────────────────────────────────────────────────

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

// ── General tab ───────────────────────────────────────────────────────────────

function GeneralTab() {
  const queryClient = useQueryClient();

  const { data: general, isLoading } = useQuery<GeneralSettings>({
    queryKey: ["settings-general"],
    queryFn: api.settings.general,
  });

  const [webhookDraft, setWebhookDraft] = useState<string | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [ttlDraft, setTtlDraft] = useState<string | null>(null);
  const [timezoneDraft, setTimezoneDraft] = useState<string | null>(null);

  const webhook = webhookDraft ?? general?.discord_webhook_url ?? "";
  const retention = retentionDraft ?? String(general?.log_retention_days ?? 7);
  const ttl = ttlDraft ?? String(general?.exited_container_ttl_hours ?? 0.083);
  const timezone = timezoneDraft ?? general?.timezone ?? "UTC";

  const [webhookSaved, setWebhookSaved] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);
  const [timezoneSaved, setTimezoneSaved] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: (body: Partial<GeneralSettings>) => api.settings.saveGeneral(body),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["settings-general"] });
      if ("discord_webhook_url" in variables) {
        setWebhookDraft(null);
        setWebhookSaved(true);
        setWebhookError(null);
        setTimeout(() => setWebhookSaved(false), 3_000);
      }
      if ("log_retention_days" in variables || "exited_container_ttl_hours" in variables) {
        setRetentionDraft(null);
        setTtlDraft(null);
        setRetentionSaved(true);
        setRetentionError(null);
        setTimeout(() => setRetentionSaved(false), 3_000);
      }
      if ("timezone" in variables) {
        setTimezoneDraft(null);
        setTimezoneSaved(true);
        setTimezoneError(null);
        setTimeout(() => setTimezoneSaved(false), 3_000);
      }
    },
    onError: (err: Error, variables) => {
      if ("discord_webhook_url" in variables) setWebhookError(err.message);
      if ("log_retention_days" in variables || "exited_container_ttl_hours" in variables) setRetentionError(err.message);
      if ("timezone" in variables) setTimezoneError(err.message);
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-slate-500">Loading…</div>;
  }

  const retentionNum = parseInt(retention, 10);
  const retentionValid = !isNaN(retentionNum) && retentionNum >= 1 && retentionNum <= 365;
  const ttlNum = parseFloat(ttl);
  const ttlValid = !isNaN(ttlNum) && ttlNum >= 0;

  return (
    <div className="space-y-8">
      {/* Discord webhook */}
      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Discord Webhook</h2>
          <p className="text-xs text-slate-500 mt-1">
            Paste a Discord incoming webhook URL to receive container event alerts.
          </p>
        </div>
        <WebhookField
          value={webhook}
          onChange={setWebhookDraft}
          disabled={isSaving}
        />
        <div className="flex items-center gap-3">
          <button
            disabled={isSaving || webhookDraft === null}
            onClick={() => save({ discord_webhook_url: webhook })}
            className="px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
          {webhookSaved && <span className="text-xs text-green-400">Saved.</span>}
          {webhookError && <span className="text-xs text-red-400">{webhookError}</span>}
        </div>
      </section>

      {/* Data & Retention */}
      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Data & Retention</h2>
          <p className="text-xs text-slate-500 mt-1">
            Logs and events older than the retention period are deleted during the hourly cleanup job.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Log retention (days)</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={365}
                value={retention}
                onChange={(e) => setRetentionDraft(e.target.value)}
                className="w-24 bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Exited container TTL (hours)</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                step={0.001}
                value={ttl}
                onChange={(e) => setTtlDraft(e.target.value)}
                className="w-24 bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent"
              />
              <span className="text-xs text-slate-500">Set to 0 to disable</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled={isSaving || (retentionDraft === null && ttlDraft === null) || !retentionValid || !ttlValid}
            onClick={() => {
              const body: Partial<GeneralSettings> = {};
              if (retentionDraft !== null) body.log_retention_days = retentionNum;
              if (ttlDraft !== null) body.exited_container_ttl_hours = ttlNum;
              save(body);
            }}
            className="px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
          {retentionSaved && <span className="text-xs text-green-400">Saved.</span>}
          {retentionError && <span className="text-xs text-red-400">{retentionError}</span>}
        </div>
      </section>

      {/* Timezone */}
      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Timezone</h2>
          <p className="text-xs text-slate-500 mt-1">
            IANA timezone name — controls all timestamps in the UI.
          </p>
        </div>
        <TimezoneSelect
          value={timezone}
          onChange={setTimezoneDraft}
          disabled={isSaving}
        />
        <div className="flex items-center gap-3">
          <button
            disabled={isSaving || timezoneDraft === null}
            onClick={() => save({ timezone })}
            className="px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
          {timezoneSaved && <span className="text-xs text-green-400">Saved.</span>}
          {timezoneError && <span className="text-xs text-red-400">{timezoneError}</span>}
        </div>
      </section>
    </div>
  );
}

// ── Notifications tab ─────────────────────────────────────────────────────────

function NotificationsTab() {
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

  const groups: Record<string, Container[]> = {};
  const ungrouped: Container[] = [];
  for (const c of containers) {
    if (c.compose_project) {
      (groups[c.compose_project] ??= []).push(c);
    } else {
      ungrouped.push(c);
    }
  }

  if (isLoading) {
    return <div className="py-12 text-center text-slate-500">Loading…</div>;
  }

  if (containers.length === 0) {
    return (
      <div className="card p-6 text-center text-slate-500">
        No containers found. Is the collector running?
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Column labels */}
      <div className="flex items-center justify-end gap-5 pr-0.5">
        {ALERT_TYPES.map(({ key, label }) => (
          <span key={key} className="w-9 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
            {label}
          </span>
        ))}
      </div>

      {Object.entries(groups).map(([project, members]) => (
        <section key={project} className="card">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{project}</span>
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

      <p className="text-xs text-slate-600">
        Settings are only meaningful when a Discord webhook URL is configured. Events are always recorded in the timeline regardless.
      </p>
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────

type Tab = "general" | "notifications";

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const { data: versionData } = useQuery({
    queryKey: ["version"],
    queryFn: api.version,
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
        {versionData && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
            Nestview v{versionData.version}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(["general", "notifications"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-accent text-slate-100"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "general" ? <GeneralTab /> : <NotificationsTab />}
    </div>
  );
}
