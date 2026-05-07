export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

export function formatUptime(startedAt: string): string {
  // Naive UTC strings from the backend have no Z suffix; append one so the
  // browser parses them as UTC rather than local time.
  const normalized = /[Z+]/.test(startedAt) ? startedAt : startedAt + "Z";
  const diff = Math.floor((Date.now() - new Date(normalized).getTime()) / 1000);

  if (!Number.isFinite(diff) || diff < 0) return "-";

  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;

  return [
    d > 0 ? `${d}d` : "",
    h > 0 ? `${h}h` : "",
    m > 0 ? `${m}m` : "",
    `${s}s`,
  ].filter(Boolean).join(" ");
}

export function formatDateTime(iso: string, tz = "UTC"): string {
  // Naive UTC strings from the backend have no Z suffix; append one so the
  // browser parses them as UTC rather than local time.
  const normalized = /[Z+]/.test(iso) ? iso : iso + "Z";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(normalized));
}
