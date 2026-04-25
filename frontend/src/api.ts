import type { AlertEventType, AlertSetting, AuthStatus, Container, ContainerLog, ContainerEvent, GeneralSettings, MeResponse, NetworkHistoryPoint, WizardStatus } from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const resBody = await res.json().catch(() => ({}));
    throw new Error((resBody as { detail?: string }).detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  version: () => fetch(`${BASE}/version`).then((r) => r.json()) as Promise<{ version: string; build_sha: string | null }>,
  containers: {
    list: () => get<Container[]>("/containers"),
    get: (id: string) => get<Container>(`/containers/${id}`),
    stop:             (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/stop`),
    restart:          (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/restart`),
    start:            (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/start`),
    checkForUpdates:  (dockerId: string) => post<{ ok: boolean; action: string; container: string; update_available: boolean }>(`/containers/${dockerId}/check-for-updates`),
    updateAndRestart: (dockerId: string) => post<{ ok: boolean; action: string; container: string; update_available: boolean; restarted: boolean }>(`/containers/${dockerId}/update-and-restart`),
    networkHistory:   (dockerId: string) => get<NetworkHistoryPoint[]>(`/containers/${dockerId}/network-history`),
  },
  stacks: {
    stop:            (project: string) => post<{ ok: boolean; project: string; action: string; affected: number }>(`/stacks/${encodeURIComponent(project)}/stop`),
    start:           (project: string) => post<{ ok: boolean; project: string; action: string; affected: number }>(`/stacks/${encodeURIComponent(project)}/start`),
    restart:         (project: string) => post<{ ok: boolean; project: string; action: string; affected: number }>(`/stacks/${encodeURIComponent(project)}/restart`),
    checkForUpdates: (project: string) => post<{ ok: boolean; project: string; action: string; checked: number }>(`/stacks/${encodeURIComponent(project)}/check-for-updates`),
  },
  logs: {
    forContainer: (
      id: string,
      params?: { search?: string; stream?: string; limit?: number; offset?: number }
    ) => {
      const qs = new URLSearchParams();
      if (params?.search) qs.set("search", params.search);
      if (params?.stream) qs.set("stream", params.stream);
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.offset != null) qs.set("offset", String(params.offset));
      const q = qs.toString();
      return get<ContainerLog[]>(`/containers/${id}/logs${q ? `?${q}` : ""}`);
    },
  },
  events: {
    list: (containerId?: string, limit = 50) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (containerId) qs.set("container_id", containerId);
      return get<ContainerEvent[]>(`/events?${qs}`);
    },
  },
  admin: {
    checkImages: () => post<{ ok: boolean }>("/admin/check-images"),
  },
  auth: {
    status: () => get<AuthStatus>("/auth/status"),
    setup: (body: { username?: string; password?: string; auth_mode: "password" | "none" }) =>
      post<{ ok: boolean }>("/auth/setup", body),
    login: (body: { username: string; password: string }) =>
      post<{ ok: boolean; auth_mode: string }>("/auth/login", body),
    logout: () => post<{ ok: boolean }>("/auth/logout"),
    me: () => get<MeResponse>("/auth/me"),
    changePassword: (body: { current_password: string; new_password: string }) =>
      post<{ ok: boolean }>("/auth/change-password", body),
    patchMode: (body: { auth_mode: "password" | "none"; username?: string; password?: string }) =>
      patch<{ ok: boolean }>("/auth/mode", body),
  },
  settings: {
    alerts: () => get<AlertSetting[]>("/settings/alerts"),
    setAlert: (container_name: string, event_type: AlertEventType, enabled: boolean) =>
      patch<AlertSetting>("/settings/alerts", { container_name, event_type, enabled }),
    general: () => get<GeneralSettings>("/settings/general"),
    saveGeneral: (body: Partial<GeneralSettings>) =>
      patch<GeneralSettings>("/settings/general", body),
    getAll: () => get<Record<string, string>>("/settings"),
    save: (body: Record<string, string>) => patch<Record<string, string>>("/settings", body),
    testWebhook: (url?: string) => post<{ ok: boolean; error?: string }>("/settings/test-webhook", url !== undefined ? { url } : undefined),
    wizard: () => get<WizardStatus>("/settings/wizard"),
    dismissWizard: () => post<{ ok: boolean }>("/settings/wizard/dismiss"),
  },
};
