export interface Container {
  id: number;
  docker_id: string;
  short_id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  restart_count: number;
  cpu_percent: number;
  mem_usage: number;
  mem_limit: number;
  ports: string[];
  volumes: string[];
  networks: string[];
  compose_project: string | null;
  compose_service: string | null;
  created_at: string | null;
  started_at: string | null;
  last_seen: string;
}

export interface ContainerLog {
  id: number;
  container_id: string;
  container_name: string;
  timestamp: string;
  stream: string;
  message: string;
}

export interface ContainerEvent {
  id: number;
  container_id: string;
  container_name: string;
  event_type: string;
  timestamp: string;
  details: string | null;
  alerted: boolean;
}
