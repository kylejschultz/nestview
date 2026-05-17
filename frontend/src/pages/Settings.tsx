import React, { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { AlertEventType, AlertSetting, AnalyticsStatus, Container, GeneralSettings } from "../types";
import WebhookField from "../components/WebhookField";
import DiscordWebhookHelpModal from "../components/DiscordWebhookHelpModal";
import TimezoneSelect from "../components/TimezoneSelect";
import Toast from "../components/Toast";
import InfoPopover from "../components/InfoPopover";
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

// ── Notifications tab types and helpers ───────────────────────────────────────

type AlertDefaults = Record<AlertEventType, boolean>;
type ExceptionMap = Record<string, Record<AlertEventType, boolean>>;

const NOTIF_TYPES: { key: AlertEventType; label: string; columnLabel?: string }[] = [
  { key: "crash", label: "Crash" },
  { key: "restart", label: "Restart" },
  { key: "oom", label: "OOM" },
  { key: "update_available", label: "Update available", columnLabel: "Update" },
];

function buildDefaultsFromRaw(raw: { event_type: string; enabled: boolean }[]): AlertDefaults {
  const base: AlertDefaults = { crash: true, restart: true, oom: true, update_available: true };
  for (const r of raw) {
    if (r.event_type === "crash" || r.event_type === "restart" || r.event_type === "oom" || r.event_type === "update_available") {
      base[r.event_type] = r.enabled;
    }
  }
  return base;
}

function buildExceptionsFromSettings(settings: AlertSetting[], defaults: AlertDefaults): ExceptionMap {
  const byContainer: Record<string, Partial<Record<AlertEventType, boolean>>> = {};
  for (const row of settings) {
    byContainer[row.container_name] ??= {};
    byContainer[row.container_name][row.event_type as AlertEventType] = row.enabled;
  }
  const result: ExceptionMap = {};
  for (const [name, vals] of Object.entries(byContainer)) {
    result[name] = {
      crash: vals.crash ?? defaults.crash,
      restart: vals.restart ?? defaults.restart,
      oom: vals.oom ?? defaults.oom,
      update_available: vals.update_available ?? defaults.update_available,
    };
  }
  return result;
}

function defaultsEqual(a: AlertDefaults | null, b: AlertDefaults | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return NOTIF_TYPES.every(({ key }) => a[key] === b[key]);
}

function exceptionsEqual(a: ExceptionMap | null, b: ExceptionMap | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return false;
  return ka.every(k => NOTIF_TYPES.every(({ key }) => a[k][key] === b[k][key]));
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
          href="https://discord.gg/aDEBQq3XtN"
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

const inputBase = "bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed";
const narrowInput = `${inputBase} w-12 text-right px-2`;

function GeneralTab({ authMode, version, onDirtyChange }: { authMode?: string; version?: string; onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const { data: general, isLoading } = useQuery<GeneralSettings>({
    queryKey: ["settings-general"],
    queryFn: api.settings.general,
    enabled: isAuthenticated,
  });

  const { data: allSettings, isLoading: isLoadingAll } = useQuery<Record<string, string>>({
    queryKey: ["settings-all"],
    queryFn: api.settings.getAll,
    enabled: isAuthenticated,
  });

  const [webhookDraft, setWebhookDraft] = useState<string | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [netRetentionDraft, setNetRetentionDraft] = useState<number | null>(null);
  const [timezoneDraft, setTimezoneDraft] = useState<string | null>(null);
  const [sessionExpiryDraft, setSessionExpiryDraft] = useState<string | null>(null);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [authModeDraft, setAuthModeDraft] = useState<"password" | "none" | null>(null);
  const [noAuthConfirmed, setNoAuthConfirmed] = useState(false);
  const [showWebhookHelp, setShowWebhookHelp] = useState(false);

  const { data: analyticsStatus } = useQuery<AnalyticsStatus>({
    queryKey: ["analytics-status"],
    queryFn: api.analytics.status,
    enabled: isAuthenticated,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const serverEnabled = (allSettings?.image_check_enabled ?? "true") !== "false";
  const serverTime = allSettings?.image_check_time ?? "03:00";

  const webhook = webhookDraft ?? general?.discord_webhook_url ?? "";
  const retention = retentionDraft ?? String(general?.log_retention_days ?? 7);
  const netRetention = netRetentionDraft ?? general?.network_history_retention_hours ?? 6;
  const timezone = timezoneDraft ?? general?.timezone ?? "UTC";
  const imageEnabled = enabledDraft ?? serverEnabled;
  const imageTime = timeDraft ?? serverTime;

  const { toastState, showToast, dismissToast } = useToast();

  const retentionNum = parseInt(retention, 10);
  const retentionValid = !isNaN(retentionNum) && retentionNum >= 1 && retentionNum <= 365;
  const netRetentionValid = !isNaN(netRetention) && netRetention >= 1 && netRetention <= 48;
  const selectedMode = authModeDraft ?? authMode ?? "password";
  const modeHasDraft = authModeDraft !== null && authModeDraft !== authMode;
  const sessionExpiryApplies = selectedMode === "password" && authMode === "password";

  const isDirty =
    webhookDraft !== null ||
    retentionDraft !== null ||
    netRetentionDraft !== null ||
    timezoneDraft !== null ||
    timeDraft !== null ||
    (sessionExpiryDraft !== null && sessionExpiryApplies);

  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const { mutate: saveAll, isPending: isSavingAll } = useMutation({
    mutationFn: async () => {
      const generalBody: Partial<GeneralSettings> = {};
      if (webhookDraft !== null) generalBody.discord_webhook_url = webhook;
      if (retentionDraft !== null && retentionValid) generalBody.log_retention_days = retentionNum;
      if (netRetentionDraft !== null && netRetentionValid) generalBody.network_history_retention_hours = netRetention;
      if (timezoneDraft !== null) generalBody.timezone = timezone;

      const rawBody: Record<string, string> = {};
      if (timeDraft !== null) rawBody.image_check_time = imageTime;
      if (sessionExpiryDraft !== null && sessionExpiryApplies) rawBody.session_expiry_days = sessionExpiryDraft;

      const calls: Promise<unknown>[] = [];
      if (Object.keys(generalBody).length > 0) calls.push(api.settings.saveGeneral(generalBody));
      if (Object.keys(rawBody).length > 0) calls.push(api.settings.save(rawBody));
      await Promise.all(calls);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-general"] });
      queryClient.invalidateQueries({ queryKey: ["settings-all"] });
      setWebhookDraft(null);
      setRetentionDraft(null);
      setNetRetentionDraft(null);
      setTimezoneDraft(null);
      setTimeDraft(null);
      setSessionExpiryDraft(null);
      showToast("Settings saved", "success");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const { mutate: saveAutoCheck } = useMutation({
    mutationFn: (enabled: boolean) => api.settings.save({ image_check_enabled: enabled ? "true" : "false" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-all"] });
      setEnabledDraft(null);
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const { mutate: checkNow, isPending: isChecking } = useMutation({
    mutationFn: api.admin.checkImages,
    onSuccess: () => showToast("Image check complete", "success"),
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const { mutate: changePassword, isPending: isChangingPw } = useMutation({
    mutationFn: api.auth.changePassword,
    onSuccess: () => {
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwError(null);
      showToast("Password updated", "success");
    },
    onError: (err: Error) => {
      if (err.message === "Current password is incorrect.") {
        setPwError("Current password is incorrect.");
      } else {
        setPwError(err.message);
      }
    },
  });

  const { mutate: saveAuthMode, isPending: isSavingAuthMode } = useMutation({
    mutationFn: async (body: { auth_mode: "password" | "none"; username?: string; password?: string }) => {
      await api.auth.patchMode(body);
      return body.auth_mode;
    },
    onSuccess: async (mode) => {
      if (mode === "none") {
        queryClient.invalidateQueries({ queryKey: ["auth-status"] });
        setAuthModeDraft(null);
        setNoAuthConfirmed(false);
        showToast("Authentication disabled", "success");
      } else {
        try {
          await api.auth.logout();
        } catch {
          // session will be invalid regardless; proceed to redirect
        }
        window.location.href = "/login";
      }
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const { mutate: toggleAnalytics, isPending: isTogglingAnalytics } = useMutation({
    mutationFn: (enable: boolean) => enable ? api.analytics.optIn() : api.analytics.optOut(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics-status"] });
      queryClient.invalidateQueries({ queryKey: ["settings-all"] });
      showToast("Analytics preference saved", "success");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  if (isLoading || isLoadingAll) {
    return <div className="py-12 text-center text-slate-500">Loading...</div>;
  }

  return (
    <div className="space-y-2">
      {toastState && (
        <Toast
          key={toastState.id}
          message={toastState.message}
          type={toastState.type}
          duration={toastState.duration}
          onDismiss={dismissToast}
        />
      )}
      {showWebhookHelp && <DiscordWebhookHelpModal onClose={() => setShowWebhookHelp(false)} />}

      {/* Row 1: Discord Webhook URL - full width */}
      <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
        <div className="flex items-start gap-4 px-4 py-2.5">
          <div className="flex flex-col shrink-0 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-slate-300">Discord Webhook URL</span>
              <InfoPopover content="The Discord webhook URL used to send container event alerts. Leave blank to disable Discord notifications." />
            </div>
            <button
              type="button"
              onClick={() => setShowWebhookHelp(true)}
              className="text-xs text-slate-500 hover:text-accent transition-colors text-left mt-0.5"
            >
              How do I get this?
            </button>
          </div>
          <div className="flex-1 min-w-0">
            <WebhookField
              value={webhook}
              onChange={setWebhookDraft}
              disabled={isSavingAll}
              onTestSuccess={() => showToast("Webhook test successful", "success")}
              onTestError={(msg) => showToast(msg, "error")}
              hideHelpLink
            />
          </div>
        </div>
      </div>

      {/* Row 2: Auth (left, tall) + Retention/Timezone/Analytics/Image Updates (right) */}
      <div className="grid grid-cols-2 gap-2">

        {/* Left: Auth card */}
        <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
          <div className={`flex items-start gap-4 px-4 py-2.5 ${sessionExpiryApplies ? "border-b border-border" : ""}`}>
            <span className="text-sm text-slate-300 shrink-0 pt-1.5">Authentication Mode</span>
            <div className="flex-1 space-y-3">
              <select
                value={selectedMode}
                onChange={(e) => { setAuthModeDraft(e.target.value as "password" | "none"); setNoAuthConfirmed(false); setNewPw(""); setConfirmPw(""); }}
                disabled={isSavingAuthMode}
                className={inputBase}
              >
                <option value="password">Password Authentication</option>
                <option value="none">No Authentication</option>
              </select>

              {/* State 1: password -> no auth confirmation */}
              {selectedMode === "none" && modeHasDraft && (
                <>
                  <label className="flex items-start gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={noAuthConfirmed}
                      onChange={(e) => setNoAuthConfirmed(e.target.checked)}
                      className="mt-0.5 accent-accent"
                    />
                    <span className="text-xs text-slate-400">I understand this will remove all authentication requirements.</span>
                  </label>
                  <button
                    disabled={isSavingAuthMode || !noAuthConfirmed}
                    onClick={() => saveAuthMode({ auth_mode: "none" })}
                    className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isSavingAuthMode ? "Saving..." : "Disable password auth"}
                  </button>
                </>
              )}

              {/* State 2: no auth -> password, set new credentials */}
              {selectedMode === "password" && authMode === "none" && (
                <>
                  <div className="space-y-1.5">
                    <input
                      type="password"
                      placeholder="New password (min 8 characters)"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      disabled={isSavingAuthMode}
                      className={`${inputBase} w-full`}
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      disabled={isSavingAuthMode}
                      className={`${inputBase} w-full`}
                    />
                    {newPw.length > 0 && newPw.length < 8 && (
                      <p className="text-xs text-red-400">Password must be at least 8 characters.</p>
                    )}
                    {confirmPw && newPw !== confirmPw && (
                      <p className="text-xs text-red-400">Passwords do not match.</p>
                    )}
                  </div>
                  <button
                    disabled={isSavingAuthMode || !newPw || newPw.length < 8 || newPw !== confirmPw}
                    onClick={() => saveAuthMode({ auth_mode: "password", username: "admin", password: newPw })}
                    className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isSavingAuthMode ? "Saving..." : "Enable password auth"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* State 3: Session Expiry row */}
          {sessionExpiryApplies && (
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <span className="text-sm text-slate-300">Session Expiry</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={sessionExpiryDraft ?? (allSettings?.session_expiry_days ?? "7")}
                  onChange={(e) => setSessionExpiryDraft(e.target.value)}
                  disabled={isSavingAll}
                  className={narrowInput}
                />
                <span className="w-14 text-slate-500 text-sm">days</span>
              </div>
            </div>
          )}

          {/* State 3: Change Password sub-section */}
          {sessionExpiryApplies && (
            <>
              <p className="text-xs text-slate-500 uppercase tracking-wider px-4 pt-3 pb-1">Change Password</p>
              <div className="px-4 pb-4 space-y-1.5">
                <input
                  type="password"
                  placeholder="Current password"
                  value={currentPw}
                  onChange={(e) => { setCurrentPw(e.target.value); setPwError(null); }}
                  disabled={isChangingPw}
                  className={`${inputBase} w-full`}
                />
                {pwError === "Current password is incorrect." && (
                  <p className="text-xs text-red-400">{pwError}</p>
                )}
                <input
                  type="password"
                  placeholder="New password (min 8 characters)"
                  value={newPw}
                  onChange={(e) => { setNewPw(e.target.value); setPwError(null); }}
                  disabled={isChangingPw}
                  className={`${inputBase} w-full`}
                />
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPw}
                  onChange={(e) => { setConfirmPw(e.target.value); setPwError(null); }}
                  disabled={isChangingPw}
                  className={`${inputBase} w-full`}
                />
                {confirmPw && newPw !== confirmPw && (
                  <p className="text-xs text-red-400">Passwords do not match.</p>
                )}
                <button
                  disabled={isChangingPw || !currentPw || !newPw || !confirmPw || newPw !== confirmPw || newPw.length < 8}
                  onClick={() => {
                    setPwError(null);
                    changePassword({ current_password: currentPw, new_password: newPw });
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isChangingPw ? "Saving..." : "Change password"}
                </button>
                {pwError && pwError !== "Current password is incorrect." && (
                  <p className="text-xs text-red-400">{pwError}</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right: four stacked cards */}
        <div className="flex flex-col gap-2">

          {/* Retention */}
          <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <span className="text-sm text-slate-300">Log Retention</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={retention}
                  onChange={(e) => setRetentionDraft(e.target.value)}
                  disabled={isSavingAll}
                  className={narrowInput}
                />
                <span className="w-14 text-slate-500 text-sm">days</span>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-slate-300">Metrics History</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={48}
                  step={1}
                  value={netRetention}
                  onChange={(e) => setNetRetentionDraft(parseInt(e.target.value, 10))}
                  disabled={isSavingAll}
                  className={narrowInput}
                />
                <span className="w-14 text-slate-500 text-sm">hours</span>
              </div>
            </div>
          </div>

          {/* Display Timezone */}
          <div className="bg-surface-2 border border-border rounded-xl">
            <div className="flex items-center justify-between px-4 py-2.5 rounded-xl">
              <span className="text-sm text-slate-300">Display Timezone</span>
              <TimezoneSelect value={timezone} onChange={setTimezoneDraft} disabled={isSavingAll} />
            </div>
          </div>

          {/* Anonymous Analytics */}
          <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-slate-300">Anonymous Analytics</span>
              <Toggle
                checked={analyticsStatus?.analytics_enabled ?? false}
                onChange={(v) => toggleAnalytics(v)}
                disabled={isTogglingAnalytics}
              />
            </div>
          </div>

          {/* Image Updates */}
          <div className="bg-surface-2 border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <span className="text-sm text-slate-300">Auto-Check for Updates</span>
              <Toggle
                checked={imageEnabled}
                onChange={(v) => { setEnabledDraft(v); saveAutoCheck(v); }}
              />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm text-slate-300">Daily Check Time</span>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={imageTime}
                  onChange={(e) => setTimeDraft(e.target.value)}
                  disabled={isSavingAll || !imageEnabled}
                  className={inputBase}
                />
                <button
                  disabled={isChecking}
                  onClick={() => checkNow()}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isChecking ? "Checking..." : "Run now"}
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Save bar */}
      <div className="border-t border-border bg-surface-2/95 px-5 py-3 flex items-center justify-between">
        <span className={`text-xs ${isDirty ? "text-amber-400" : "text-slate-600"}`}>
          {isDirty ? "You have unsaved changes." : "No unsaved changes."}
        </span>
        <button
          disabled={!isDirty || isSavingAll || !retentionValid || !netRetentionValid}
          onClick={() => saveAll()}
          className="px-4 py-1.5 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSavingAll ? "Saving..." : "Save"}
        </button>
      </div>

    </div>
  );
}

// ── Add exception modal ───────────────────────────────────────────────────────

function AddExceptionModal({
  allContainers,
  existingNames,
  onAdd,
  onClose,
}: {
  allContainers: Container[];
  existingNames: Set<string>;
  onAdd: (name: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const seen = new Set<string>();
  const filtered = allContainers.filter(c => {
    if (existingNames.has(c.name) || seen.has(c.name)) return false;
    seen.add(c.name);
    return c.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-2 border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-slate-200">Add exception</h3>
        <input
          type="text"
          placeholder="Search containers..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
          className="w-full bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent"
        />
        <div className="max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-500 py-3 text-center">No containers available to add</p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map(c => (
                <button
                  key={c.name}
                  onClick={() => { onAdd(c.name); onClose(); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-surface-3 hover:text-slate-100 transition-colors"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-border text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Notifications tab ─────────────────────────────────────────────────────────

function NotificationsTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { toastState, showToast, dismissToast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: defaultsRaw = [], isLoading: loadingDefaults } = useQuery<{ event_type: string; enabled: boolean }[]>({
    queryKey: ["alert-defaults"],
    queryFn: api.settings.alertDefaults,
    enabled: isAuthenticated,
  });

  const { data: alertSettings = [], isLoading: loadingAlerts } = useQuery<AlertSetting[]>({
    queryKey: ["alert-settings"],
    queryFn: api.settings.alerts,
    enabled: isAuthenticated,
  });

  const { data: allContainers = [] } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
    enabled: isAuthenticated,
  });

  const savedDefaults = useMemo(() => buildDefaultsFromRaw(defaultsRaw), [defaultsRaw]);
  const savedExceptions = useMemo(
    () => buildExceptionsFromSettings(alertSettings, savedDefaults),
    [alertSettings, savedDefaults]
  );

  const [draftDefaults, setDraftDefaults] = useState<AlertDefaults | null>(null);
  const [draftExceptions, setDraftExceptions] = useState<ExceptionMap | null>(null);
  const [lastSavedDefaults, setLastSavedDefaults] = useState<AlertDefaults | null>(null);
  const [lastSavedExceptions, setLastSavedExceptions] = useState<ExceptionMap | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && !loadingDefaults && !loadingAlerts) {
      setDraftDefaults(savedDefaults);
      setDraftExceptions(savedExceptions);
      setLastSavedDefaults(savedDefaults);
      setLastSavedExceptions(savedExceptions);
      initialized.current = true;
    }
  }, [loadingDefaults, loadingAlerts]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty =
    !defaultsEqual(draftDefaults, lastSavedDefaults) ||
    !exceptionsEqual(draftExceptions, lastSavedExceptions);

  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      if (!draftDefaults || draftExceptions === null || lastSavedExceptions === null) return;

      await api.settings.setAlertDefaults(
        NOTIF_TYPES.map(({ key }) => ({ event_type: key, enabled: draftDefaults[key] }))
      );

      const calls: Promise<unknown>[] = [];
      for (const [name, vals] of Object.entries(draftExceptions)) {
        for (const { key } of NOTIF_TYPES) {
          if (vals[key] !== draftDefaults[key]) {
            calls.push(api.settings.setAlert(name, key, vals[key]));
          }
        }
      }
      for (const name of Object.keys(lastSavedExceptions)) {
        if (!draftExceptions[name]) {
          for (const { key } of NOTIF_TYPES) {
            calls.push(api.settings.setAlert(name, key, draftDefaults[key]));
          }
        }
      }
      await Promise.all(calls);
    },
    onSuccess: () => {
      if (!draftDefaults || draftExceptions === null) return;
      const cleaned: ExceptionMap = {};
      for (const [name, vals] of Object.entries(draftExceptions)) {
        if (NOTIF_TYPES.some(({ key }) => vals[key] !== draftDefaults[key])) {
          cleaned[name] = vals;
        }
      }
      setDraftExceptions(cleaned);
      setLastSavedDefaults({ ...draftDefaults });
      setLastSavedExceptions(cleaned);
      queryClient.invalidateQueries({ queryKey: ["alert-defaults"] });
      queryClient.invalidateQueries({ queryKey: ["alert-settings"] });
      showToast("Saved", "success");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const isLoading = loadingDefaults || loadingAlerts;

  if (isLoading || draftDefaults === null || draftExceptions === null) {
    return <div className="py-12 text-center text-slate-500">Loading...</div>;
  }

  const exceptionNames = new Set(Object.keys(draftExceptions));
  const sortedExceptions = Object.entries(draftExceptions).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      {toastState && (
        <Toast key={toastState.id} message={toastState.message} type={toastState.type} duration={toastState.duration} onDismiss={dismissToast} />
      )}

      <div className="space-y-4">
        {/* Global defaults card */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-slate-200">Global defaults</h2>
            <p className="text-xs text-slate-500 mt-0.5">Applies to all containers without an exception configured.</p>
          </div>
          {NOTIF_TYPES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between px-5 py-3 border-b border-border last:border-0">
              <span className="text-sm text-slate-300">{label}</span>
              <Toggle
                checked={draftDefaults[key]}
                onChange={(v) => setDraftDefaults(prev => prev ? { ...prev, [key]: v } : prev)}
              />
            </div>
          ))}
        </div>

        {/* Exceptions table */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Container exceptions</h2>
              <p className="text-xs text-slate-500 mt-0.5">Overrides for individual containers.</p>
            </div>
            {sortedExceptions.length > 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-surface-3 border border-border text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add exception
              </button>
            )}
          </div>

          {sortedExceptions.length === 0 ? (
            <div className="px-5 py-8 text-center space-y-3">
              <p className="text-sm text-slate-500">All containers are following global defaults.</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-3 py-1.5 text-xs rounded-lg bg-surface-3 border border-border text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors"
              >
                Add exception
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-5 py-2 border-b border-border bg-surface-3/40">
                <span className="flex-1 text-xs font-medium uppercase tracking-wide text-slate-500">Container</span>
                {NOTIF_TYPES.map(({ key, label, columnLabel }) => (
                  <span key={key} className="w-20 shrink-0 text-center text-xs font-medium uppercase tracking-wide text-slate-500">{columnLabel ?? label}</span>
                ))}
                <span className="w-8 shrink-0" />
              </div>
              {sortedExceptions.map(([name, vals]) => (
                <div key={name} className="flex items-center gap-2 px-5 py-2.5 border-b border-border last:border-0">
                  <span className="flex-1 min-w-0 text-sm text-slate-300 truncate">{name}</span>
                  {NOTIF_TYPES.map(({ key }) => (
                    <div key={key} className="w-20 shrink-0 flex justify-center">
                      <Toggle
                        checked={vals[key]}
                        onChange={(v) =>
                          setDraftExceptions(prev =>
                            prev ? { ...prev, [name]: { ...prev[name], [key]: v } } : prev
                          )
                        }
                      />
                    </div>
                  ))}
                  <div className="w-8 shrink-0 flex justify-center">
                    <button
                      onClick={() =>
                        setDraftExceptions(prev => {
                          if (!prev) return prev;
                          const next = { ...prev };
                          delete next[name];
                          return next;
                        })
                      }
                      aria-label={`Remove exception for ${name}`}
                      className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-surface-3 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <p className="text-xs text-slate-600">Alert toggles only take effect when a Discord webhook URL is configured. Events are always recorded regardless.</p>

        {/* Save bar */}
        <div className="sticky bottom-0 border-t border-border bg-surface-2/95 backdrop-blur-sm px-5 py-3 flex items-center justify-between">
          <span className={`text-xs ${isDirty ? "text-amber-400" : "text-slate-600"}`}>
            {isDirty ? "You have unsaved changes" : "No unsaved changes"}
          </span>
          <button
            disabled={!isDirty || isSaving}
            onClick={() => save()}
            className="px-4 py-1.5 text-sm rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {showAddModal && (
        <AddExceptionModal
          allContainers={allContainers}
          existingNames={exceptionNames}
          onAdd={(name) =>
            setDraftExceptions(prev =>
              prev ? { ...prev, [name]: { ...draftDefaults } } : prev
            )
          }
          onClose={() => setShowAddModal(false)}
        />
      )}
    </>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────

type Tab = "general" | "notifications" | "about";

export default function Settings({ authMode }: { authMode?: string }) {
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [notifDirty, setNotifDirty] = useState(false);
  const [generalDirty, setGeneralDirty] = useState(false);
  const { isAuthenticated } = useAuth();

  function handleTabChange(tab: Tab) {
    if (tab === activeTab) return;
    if (activeTab === "notifications" && notifDirty) {
      if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
    }
    if (activeTab === "general" && generalDirty) {
      if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
    }
    setActiveTab(tab);
  }
  const { data: versionData } = useQuery({
    queryKey: ["version"],
    queryFn: api.version,
    staleTime: Infinity,
    retry: false,
    enabled: isAuthenticated,
  });

  return (
    <div className="max-w-4xl space-y-6">
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
        {(["general", "notifications", "about"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
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

      {activeTab === "general" && <GeneralTab authMode={authMode} version={versionData?.version} onDirtyChange={setGeneralDirty} />}
      {activeTab === "notifications" && <NotificationsTab onDirtyChange={setNotifDirty} />}
      {activeTab === "about" && <AboutSection version={versionData?.version} />}
    </div>
  );
}
