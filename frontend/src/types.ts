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
  update_available: boolean;
  image_size: number | null;
  last_pulled: string | null;
  last_digest_check: string | null;
  image_digest: string | null;
  registry_digest: string | null;
}

export interface ContainerLog {
  id: number;
  container_id: string;
  container_name: string;
  timestamp: string;
  stream: string;
  message: string;
}

export type AlertEventType = "crash" | "restart" | "oom" | "update_available";

export interface AlertSetting {
  id: number;
  container_name: string;
  event_type: AlertEventType;
  enabled: boolean;
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

export interface GeneralSettings {
  discord_webhook_url: string;
  log_retention_days: number;
  exited_container_ttl_hours: number;
  timezone: string;
}

export interface WizardStatus {
  completed: boolean;
}
