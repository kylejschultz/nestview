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
  last_digest_check: string | null;
  net_rx_bytes: number | null;
  net_tx_bytes: number | null;
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
  exited_container_ttl_seconds: number;
  timezone: string;
  network_history_retention_hours: number;
}

export interface WizardStatus {
  completed: boolean;
}

export interface AuthStatus {
  setup_required: boolean;
  auth_mode: "password" | "none";
}

export interface MeResponse {
  authenticated: boolean;
  username: string | null;
  auth_mode: string;
}

export interface NetworkHistoryPoint {
  rx_bytes: number;
  tx_bytes: number;
  recorded_at: string;
}

export interface MetricsHistoryPoint {
  timestamp: string;
  cpu_percent: number;
  mem_usage_bytes: number;
  mem_limit_bytes: number;
}

export interface AnalyticsStatus {
  analytics_enabled: boolean;
  install_id: string;
}

export interface SystemInfo {
  version: string;
  build_channel: string;
  build_sha: string | null;
  uptime_seconds: number;
  db_size_bytes: number | null;
  docker_connected: boolean;
}
