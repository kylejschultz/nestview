import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AlertEventType, AlertSetting, Container, GeneralSettings } from "../types";
import WebhookField from "../components/WebhookField";
import TimezoneSelect from "../components/TimezoneSelect";
import Toast from "../components/Toast";
import { useToast } from "../hooks/useToast";

// ── Toggle ────────────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
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
      {label && <span className={`text-xs ${checked ? "text-slate-300" : "text-slate-600"}`}>{label}</span>}
    </label>
  );
}

// ── Alert settings helpers ────────────────────────────────────────────────────

const ALERT_TYPES: { key: AlertEventType; label: string }[] = [
  { key: "crash", label: "Crash" },
  { key: "restart", label: "Restart" },
  { key: "oom", label: "OOM" },
  { key: "update_available", label: "Update Avail" },
];

function buildDisabledSet(settings: AlertSetting[]): Set<string> {
  const s = new Set<string>();
  for (const row of settings) {
    if (!row.enabled) s.add(`${row.container_name}:${row.event_type}`);
  }
  return s;
}

// ── Per-container row (table) ─────────────────────────────────────────────────

const COL_W = "w-24";

interface ContainerRowProps {
  container: Container;
  disabledSet: Set<string>;
  onToggle: (container_name: string, event_type: AlertEventType, enabled: boolean) => void;
  isDisabled: boolean;
}

function ContainerRow({ container: c, disabledSet, onToggle, isDisabled }: ContainerRowProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{c.name}</p>
        <p className="text-xs text-slate-500 font-mono truncate mt-0.5">{c.image}</p>
      </div>
      {ALERT_TYPES.map(({ key }) => (
        <div key={key} className={`${COL_W} flex justify-center`}>
          <Toggle
            checked={!disabledSet.has(`${c.name}:${key}`)}
            disabled={isDisabled}
            onChange={(enabled) => onToggle(c.name, key, enabled)}
          />
        </div>
      ))}
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

// ── General tab ───────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-5 py-2 border-b border-border bg-surface-3/40">
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</span>
    </div>
  );
}

function SettingRow({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-start gap-4 px-5 py-3 ${last ? "" : "border-b border-border"}`}>
      <span className="w-44 shrink-0 text-sm text-slate-400 pt-0.5">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

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

  const { data: allSettings, isLoading: isLoadingAll } = useQuery<Record<string, string>>({
    queryKey: ["settings-all"],
    queryFn: api.settings.getAll,
  });

  // General settings drafts
  const [webhookDraft, setWebhookDraft] = useState<string | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [ttlDraft, setTtlDraft] = useState<string | null>(null);
  const [timezoneDraft, setTimezoneDraft] = useState<string | null>(null);

  // Image check drafts
  const serverEnabled = (allSettings?.image_check_enabled ?? "true") !== "false";
  const serverTime = allSettings?.image_check_time ?? "03:00";
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);

  // Computed values
  const webhook = webhookDraft ?? general?.discord_webhook_url ?? "";
  const retention = retentionDraft ?? String(general?.log_retention_days ?? 7);
  const ttl = ttlDraft ?? String(general?.exited_container_ttl_hours ?? 0.083);
  const timezone = timezoneDraft ?? general?.timezone ?? "UTC";
  const imageEnabled = enabledDraft ?? serverEnabled;
  const imageTime = timeDraft ?? serverTime;

  const { toastState, showToast, dismissToast } = useToast();

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: (body: Partial<GeneralSettings>) => api.settings.saveGeneral(body),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["settings-general"] });
      if ("discord_webhook_url" in variables) setWebhookDraft(null);
      if ("log_retention_days" in variables || "exited_container_ttl_hours" in variables) {
        setRetentionDraft(null);
        setTtlDraft(null);
      }
      if ("timezone" in variables) setTimezoneDraft(null);
      showToast("Settings saved", "success");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const { mutate: saveImage, isPending: isSavingImage } = useMutation({
    mutationFn: (body: Record<string, string>) => api.settings.save(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-all"] });
      setEnabledDraft(null);
      setTimeDraft(null);
      showToast("Settings saved", "success");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const { mutate: checkNow, isPending: isChecking } = useMutation({
    mutationFn: api.admin.checkImages,
    onSuccess: () => showToast("Image check complete", "success"),
    onError: (err: Error) => showToast(err.message, "error"),
  });

  if (isLoading || isLoadingAll) {
    return <div className="py-12 text-center text-slate-500">Loading…</div>;
  }

  const retentionNum = parseInt(retention, 10);
  const retentionValid = !isNaN(retentionNum) && retentionNum >= 1 && retentionNum <= 365;
  const ttlNum = parseFloat(ttl);
  const ttlValid = !isNaN(ttlNum) && ttlNum >= 0;
  const imageHasDraft = enabledDraft !== null || timeDraft !== null;

  return (
    <div className="space-y-6">
      {toastState && (
        <Toast
          key={toastState.id}
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismissToast}
        />
      )}

      <div className="card overflow-hidden">

        {/* DISCORD */}
        <SectionHeader label="Discord" />
        <SettingRow label="Webhook URL">
          <div className="space-y-2">
            <WebhookField
              value={webhook}
              onChange={setWebhookDraft}
              disabled={isSaving}
              onTestSuccess={() => showToast("Webhook test successful", "success")}
              onTestError={(msg) => showToast(msg, "error")}
            />
            <div className="flex items-center gap-2">
              <button
                disabled={isSaving || webhookDraft === null}
                onClick={() => save({ discord_webhook_url: webhook })}
                className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </SettingRow>

        {/* RETENTION */}
        <SectionHeader label="Retention" />
        <SettingRow label="Log retention">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={retention}
              onChange={(e) => setRetentionDraft(e.target.value)}
              className="w-20 bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
            />
            <span className="text-sm text-slate-500">days</span>
          </div>
        </SettingRow>
        <SettingRow label="Container TTL">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={0.001}
                value={ttl}
                onChange={(e) => setTtlDraft(e.target.value)}
                className="w-20 bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
              />
              <span className="text-sm text-slate-500">hours</span>
              <span className="text-xs text-slate-600">(0 = disabled)</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={isSaving || (retentionDraft === null && ttlDraft === null) || !retentionValid || !ttlValid}
                onClick={() => {
                  const body: Partial<GeneralSettings> = {};
                  if (retentionDraft !== null) body.log_retention_days = retentionNum;
                  if (ttlDraft !== null) body.exited_container_ttl_hours = ttlNum;
                  save(body);
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </SettingRow>

        {/* TIMEZONE */}
        <SectionHeader label="Timezone" />
        <SettingRow label="Timezone" last>
          <div className="space-y-2">
            <TimezoneSelect value={timezone} onChange={setTimezoneDraft} disabled={isSaving} />
            <div className="flex items-center gap-2">
              <button
                disabled={isSaving || timezoneDraft === null}
                onClick={() => save({ timezone })}
                className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </SettingRow>

        {/* IMAGE UPDATES */}
        <SectionHeader label="Image Updates" />
        <SettingRow label="Auto-check">
          <div className="flex items-center">
            <Toggle
              checked={imageEnabled}
              onChange={(v) => setEnabledDraft(v)}
              disabled={isSavingImage}
            />
          </div>
        </SettingRow>
        <SettingRow label="Daily check time" last>
          <div className="space-y-2">
            <input
              type="time"
              value={imageTime}
              onChange={(e) => setTimeDraft(e.target.value)}
              disabled={isSavingImage || !imageEnabled}
              className="bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={isSavingImage || !imageHasDraft}
                onClick={() => {
                  const body: Record<string, string> = {};
                  if (enabledDraft !== null) body.image_check_enabled = enabledDraft ? "true" : "false";
                  if (timeDraft !== null) body.image_check_time = imageTime;
                  saveImage(body);
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save
              </button>
              <button
                disabled={isChecking}
                onClick={() => checkNow()}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isChecking ? "Checking…" : "Check now"}
              </button>
            </div>
          </div>
        </SettingRow>

      </div>

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

  const { mutate: bulkToggle, isPending: isBulkPending } = useMutation({
    mutationFn: (changes: Array<{ container_name: string; event_type: AlertEventType; enabled: boolean }>) =>
      Promise.all(changes.map((c) => api.settings.setAlert(c.container_name, c.event_type, c.enabled))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-settings"] });
    },
  });

  const isDisabled = isPending || isBulkPending;
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

  function handleToggleAll(members: Container[]) {
    const allEnabled = members.every((c) =>
      ALERT_TYPES.every((t) => !disabledSet.has(`${c.name}:${t.key}`))
    );
    const targetEnabled = !allEnabled;
    bulkToggle(
      members.flatMap((c) =>
        ALERT_TYPES.map((t) => ({ container_name: c.name, event_type: t.key, enabled: targetEnabled }))
      )
    );
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

  const togglesWidth = `${ALERT_TYPES.length * 6}rem`; // 4 × w-24 (6rem)

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        {/* Column header row */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-3/40">
          <span className="flex-1 text-xs font-medium uppercase tracking-wide text-slate-500">Container</span>
          <div className="flex shrink-0" style={{ width: togglesWidth }}>
            {ALERT_TYPES.map(({ key, label }) => (
              <span key={key} className={`${COL_W} text-center text-xs font-medium uppercase tracking-wide text-slate-500`}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Compose stacks */}
        {Object.entries(groups).map(([project, members]) => (
          <React.Fragment key={project}>
            {/* Stack header */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-3/20">
              <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="flex-1 text-xs font-semibold uppercase tracking-widest text-slate-500 truncate">{project}</span>
              <button
                disabled={isDisabled}
                onClick={() => handleToggleAll(members)}
                className="text-xs text-slate-500 hover:text-slate-300 border border-border rounded px-2 py-0.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Toggle all
              </button>
            </div>
            {members.map((c) => (
              <ContainerRow
                key={c.docker_id}
                container={c}
                disabledSet={disabledSet}
                onToggle={(name, type, enabled) => mutate({ container_name: name, event_type: type, enabled })}
                isDisabled={isDisabled}
              />
            ))}
          </React.Fragment>
        ))}

        {/* Standalone containers */}
        {ungrouped.length > 0 && (
          <React.Fragment>
            {Object.keys(groups).length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface-3/20">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Standalone</span>
              </div>
            )}
            {ungrouped.map((c) => (
              <ContainerRow
                key={c.docker_id}
                container={c}
                disabledSet={disabledSet}
                onToggle={(name, type, enabled) => mutate({ container_name: name, event_type: type, enabled })}
                isDisabled={isDisabled}
              />
            ))}
          </React.Fragment>
        )}
      </div>

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
