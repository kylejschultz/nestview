import type { AlertEventType, AlertSetting, Container, ContainerLog, ContainerEvent, GeneralSettings, WizardStatus } from "./types";

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

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  containers: {
    list: () => get<Container[]>("/containers"),
    get: (id: string) => get<Container>(`/containers/${id}`),
    stop:    (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/stop`),
    restart: (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/restart`),
    start:   (dockerId: string) => post<{ ok: boolean; action: string; container: string }>(`/containers/${dockerId}/start`),
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
  settings: {
    alerts: () => get<AlertSetting[]>("/settings/alerts"),
    setAlert: (container_name: string, event_type: AlertEventType, enabled: boolean) =>
      patch<AlertSetting>("/settings/alerts", { container_name, event_type, enabled }),
    general: () => get<GeneralSettings>("/settings/general"),
    saveGeneral: (body: Partial<GeneralSettings>) =>
      patch<GeneralSettings>("/settings/general", body),
    testWebhook: () => post<{ ok: boolean; error?: string }>("/settings/test-webhook"),
    wizard: () => get<WizardStatus>("/settings/wizard"),
    dismissWizard: () => post<{ ok: boolean }>("/settings/wizard/dismiss"),
  },
};
