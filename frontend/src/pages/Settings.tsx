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
  { key: "update_available", label: "Update" },
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

// ── About & Support ───────────────────────────────────────────────────────────

function AboutSection({ version }: { version?: string }) {
  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">About &amp; Support</h2>
        {version && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
            Nestview v{version}
          </span>
        )}
      </div>
      <div className="space-y-3">
        {/* Discord — most prominent */}
        <a
          href="https://discord.gg/TfQ8QX3Ptr"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors group"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <div>
            <p className="text-sm font-medium">Discord</p>
            <p className="text-xs text-accent/70">Get support &amp; chat with the community</p>
          </div>
        </a>
        {/* GitHub */}
        <a
          href="https://github.com/kylejschultz/nestview"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 rounded-lg bg-surface-3 border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors group"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.929.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
          </svg>
          <div>
            <p className="text-sm font-medium">GitHub</p>
            <p className="text-xs text-slate-500">View source &amp; report issues</p>
          </div>
        </a>
        {/* Ko-fi */}
        <a
          href="https://ko-fi.com/kylejschultz"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-3 rounded-lg bg-surface-3 border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors group"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <div>
            <p className="text-sm font-medium">Ko-fi</p>
            <p className="text-xs text-slate-500">Support the project</p>
          </div>
        </a>
      </div>
    </section>
  );
}

// ── Image Updates section ─────────────────────────────────────────────────────

function ImageUpdatesSection() {
  const queryClient = useQueryClient();

  const { data: allSettings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["settings-all"],
    queryFn: api.settings.getAll,
  });

  const serverEnabled = (allSettings?.image_check_enabled ?? "true") !== "false";
  const serverTime = allSettings?.image_check_time ?? "03:00";

  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);

  const enabled = enabledDraft ?? serverEnabled;
  const time = timeDraft ?? serverTime;

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (body: Record<string, string>) => api.settings.save(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-all"] });
      setEnabledDraft(null);
      setTimeDraft(null);
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 3_000);
    },
    onError: (err: Error) => setError(err.message),
  });

  const [checkDone, setCheckDone] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const { mutate: checkNow, isPending: isChecking } = useMutation({
    mutationFn: api.admin.checkImages,
    onSuccess: () => {
      setCheckDone(true);
      setCheckError(null);
      setTimeout(() => setCheckDone(false), 3_000);
    },
    onError: (err: Error) => setCheckError(err.message),
  });

  const hasDraft = enabledDraft !== null || timeDraft !== null;

  if (isLoading) return null;

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-200">Image Updates</h2>
        <p className="text-xs text-slate-500 mt-1">
          Automatically check for newer container images on a daily schedule.
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-400">Enable automatic image update checks</p>
          <Toggle
            checked={enabled}
            onChange={(v) => setEnabledDraft(v)}
            disabled={isPending}
            label={enabled ? "On" : "Off"}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Daily check time (24h)</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTimeDraft(e.target.value)}
            disabled={isPending || !enabled}
            className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          disabled={isPending || !hasDraft}
          onClick={() => {
            const body: Record<string, string> = {};
            if (enabledDraft !== null) body.image_check_enabled = enabledDraft ? "true" : "false";
            if (timeDraft !== null) body.image_check_time = timeDraft;
            save(body);
          }}
          className="px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
        {saved && <span className="text-xs text-green-400">Saved.</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      <div className="flex items-center gap-3 pt-1 border-t border-border">
        <button
          disabled={isChecking}
          onClick={() => checkNow()}
          className="px-3 py-1.5 text-xs rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isChecking ? "Checking…" : "Check now"}
        </button>
        {checkDone && <span className="text-xs text-green-400">Check complete</span>}
        {checkError && <span className="text-xs text-red-400">{checkError}</span>}
      </div>
    </section>
  );
}

// ── General tab ───────────────────────────────────────────────────────────────

function GeneralTab() {
  const queryClient = useQueryClient();

  const { data: general, isLoading } = useQuery<GeneralSettings>({
    queryKey: ["settings-general"],
    queryFn: api.settings.general,
  });

  const { data: versionData } = useQuery({
    queryKey: ["version"],
    queryFn: api.version,
    staleTime: Infinity,
    retry: false,
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

      <ImageUpdatesSection />

      <hr className="border-border" />

      <AboutSection version={versionData?.version} />
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
