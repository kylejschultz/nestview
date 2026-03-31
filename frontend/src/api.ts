import type { Container, ContainerLog, ContainerEvent } from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  containers: {
    list: () => get<Container[]>("/containers"),
    get: (id: string) => get<Container>(`/containers/${id}`),
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
};
