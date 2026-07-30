import { FiArrowRight, FiBell, FiBox, FiCpu, FiLayers, FiSettings, FiZap } from "react-icons/fi";

interface PlaceholderPageProps {
  page: "Services" | "Containers" | "Hosts" | "Alerts" | "Notifications" | "Integrations";
}

const PAGE_COPY: Record<PlaceholderPageProps["page"], { icon: typeof FiLayers; summary: string; items: string[] }> = {
  Services: {
    icon: FiLayers,
    summary: "Flat, user-managed groupings that sit above containers without being locked to Docker Compose.",
    items: ["Suggested services from Compose and labels", "Linked containers and URLs", "Intermediate health rollups"],
  },
  Containers: {
    icon: FiBox,
    summary: "Technical inventory and drilldown for every discovered container.",
    items: ["Dense table and saved filters", "Update and health state", "Links to logs and metrics"],
  },
  Hosts: {
    icon: FiCpu,
    summary: "Node-level health, capacity, and Docker runtime context.",
    items: ["CPU, memory, disk, and Docker status", "Hosted container inventory", "Recent host-level events"],
  },
  Alerts: {
    icon: FiBell,
    summary: "Triage-focused inbox for active and historical issues.",
    items: ["Active, resolved, acknowledged, and silenced states", "Severity filtering", "Alert detail timeline"],
  },
  Notifications: {
    icon: FiSettings,
    summary: "Notification policy owns providers, delivery rules, quiet hours, and exceptions.",
    items: ["Channels and test sends", "Default rules and quiet hours", "Container and service exceptions"],
  },
  Integrations: {
    icon: FiZap,
    summary: "Connection health and setup for external systems Nestview talks to.",
    items: ["Docker endpoints", "Auth and webhooks", "Provider status checks"],
  },
};

export default function PlaceholderPage({ page }: PlaceholderPageProps) {
  const config = PAGE_COPY[page];
  const Icon = config.icon;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-surface-1 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-accent/30 bg-accent/10 p-2 text-accent">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">v2.0 section</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-100">{page}</h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">{config.summary}</p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-slate-400">
            Layout pass pending
            <FiArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {config.items.map((item) => (
          <div key={item} className="rounded-lg border border-border bg-surface-1 p-4">
            <p className="text-sm font-medium text-slate-200">{item}</p>
            <p className="mt-2 text-xs text-slate-500">Planned for the page-specific buildout after the shell review.</p>
          </div>
        ))}
      </section>
    </div>
  );
}
