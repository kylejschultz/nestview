import type { AlertEventType, AlertSetting, Container, ContainerLog, ContainerEvent, GeneralSettings, WizardStatus } from "./types";

const BASE = "/api";
const API_KEY_STORAGE_KEY = "nestview:api_key";

export function getApiKey(): string {
  return sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
}

export function setApiKey(key: string): void {
  sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearApiKey(): void {
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
}

function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { "X-API-Key": key } : {};
}

function handleAuthFailure() {
  clearApiKey();
  window.dispatchEvent(new Event("nestview:auth-required"));
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (res.status === 401 || res.status === 403) {
    handleAuthFailure();
    throw new Error("Authentication required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    handleAuthFailure();
    throw new Error("Authentication required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...authHeaders(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401 || res.status === 403) {
    handleAuthFailure();
    throw new Error("Authentication required");
  }
  if (!res.ok) {
    const resBody = await res.json().catch(() => ({}));
    throw new Error((resBody as { detail?: string }).detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  config: () => fetch(`${BASE}/config`).then((r) => r.json()) as Promise<{ api_key_required: boolean }>,
  version: () => fetch(`${BASE}/version`).then((r) => r.json()) as Promise<{ version: string }>,
  containers: {
    list: () => get<Container[]>("/containers"),
    get: (id: string) => get<Container>(`/containers/${id}`),
    stop:    (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/stop`),
    restart: (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/restart`),
    start:   (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/start`),
  },
  stacks: {
    stop:        (project: string) => post<{ ok: boolean; project: string; action: string; affected: number }>(`/stacks/${encodeURIComponent(project)}/stop`),
    start:       (project: string) => post<{ ok: boolean; project: string; action: string; affected: number }>(`/stacks/${encodeURIComponent(project)}/start`),
    restart:     (project: string) => post<{ ok: boolean; project: string; action: string; affected: number }>(`/stacks/${encodeURIComponent(project)}/restart`),
    pullRestart: (project: string) => post<{ ok: boolean; project: string; action: string; pulled: number; restarted: number }>(`/stacks/${encodeURIComponent(project)}/pull-restart`),
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
