import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "../router";
import { useQuery } from "@tanstack/react-query";
import {
  FiActivity,
  FiBell,
  FiBox,
  FiChevronLeft,
  FiChevronRight,
  FiCpu,
  FiGrid,
  FiLayers,
  FiLogOut,
  FiSettings,
  FiSliders,
  FiZap,
} from "react-icons/fi";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { Container } from "../types";
import NestviewLogo from "./NestviewLogo";

interface AppShellProps {
  children: ReactNode;
  onLogout?: () => void;
  authMode?: string;
}

const SIDEBAR_COLLAPSED_KEY = "nestview.sidebarCollapsed";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: FiGrid },
  { to: "/services", label: "Services", icon: FiLayers },
  { to: "/containers", label: "Containers", icon: FiBox },
  { to: "/hosts", label: "Hosts", icon: FiCpu },
  { to: "/alerts", label: "Alerts", icon: FiActivity },
  { to: "/notifications", label: "Notifications", icon: FiBell },
  { to: "/integrations", label: "Integrations", icon: FiZap },
  { to: "/settings", label: "Settings", icon: FiSettings },
];

function FleetStatus({ running, total }: { running: number; total: number }) {
  const allGood = running === total && total > 0;
  const hasIssues = running < total;
  const color = allGood ? "bg-emerald-400" : hasIssues ? "bg-red-400" : "bg-slate-500";
  const label = total === 0 ? "No containers" : `${running}/${total} running`;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-slate-300">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}

export default function AppShell({ children, onLogout, authMode }: AppShellProps) {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const { data: containers = [] } = useQuery<Container[]>({
    queryKey: ["containers"],
    queryFn: api.containers.list,
    refetchInterval: 10_000,
    enabled: isAuthenticated,
  });

  const { data: versionData } = useQuery({
    queryKey: ["version"],
    queryFn: api.version,
    staleTime: Infinity,
    retry: false,
    enabled: isAuthenticated,
  });

  const total = containers.length;
  const running = containers.filter((container) => container.state === "running").length;
  const activePage = NAV_ITEMS.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  return (
    <div className="min-h-screen bg-surface-0 text-slate-200 lg:flex">
      <aside
        className={`border-b border-border bg-surface-1/95 transition-[width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r ${
          sidebarCollapsed ? "lg:w-20" : "lg:w-64"
        }`}
      >
        <div className="flex h-full flex-col">
          <div
            className={`flex h-16 items-center border-b border-border px-4 ${
              sidebarCollapsed ? "lg:h-24 lg:flex-col lg:justify-center lg:gap-2 lg:px-3" : "justify-between"
            }`}
          >
            <Link
              to="/dashboard"
              aria-label="Dashboard"
              className={`min-w-0 overflow-hidden transition-[width] duration-200 ${
                sidebarCollapsed ? "lg:w-8" : "w-36"
              }`}
            >
              <NestviewLogo compact={sidebarCollapsed} />
            </Link>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden rounded-lg border border-border bg-surface-2 p-2 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100 lg:inline-flex"
            >
              {sidebarCollapsed ? <FiChevronRight className="h-4 w-4" /> : <FiChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav className={`flex gap-1 overflow-x-auto px-3 py-3 lg:flex-col lg:overflow-visible ${sidebarCollapsed ? "lg:items-center" : ""}`}>
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={sidebarCollapsed ? label : undefined}
                aria-label={sidebarCollapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    sidebarCollapsed ? "lg:h-11 lg:w-11 lg:justify-center lg:px-0" : ""
                  } ${
                    isActive
                      ? "bg-accent text-white"
                      : "text-slate-400 hover:bg-surface-2 hover:text-slate-100"
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={sidebarCollapsed ? "lg:sr-only" : ""}>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className={`mt-auto hidden border-t border-border p-4 lg:block ${sidebarCollapsed ? "lg:px-3" : ""}`}>
            <div
              className={`rounded-lg border border-border bg-surface-2 p-3 ${
                sidebarCollapsed ? "lg:flex lg:h-11 lg:items-center lg:justify-center lg:p-0" : ""
              }`}
              title={versionData ? `Build ${versionData.display_version}` : "Build loading"}
            >
              <div className="flex items-center justify-between gap-3">
                <div className={sidebarCollapsed ? "lg:sr-only" : ""}>
                  <p className="text-xs uppercase text-slate-500">Build</p>
                  <p className="mt-1 text-sm text-slate-200">
                    {versionData ? versionData.display_version : "Loading"}
                  </p>
                </div>
                <FiSliders className="h-4 w-4 text-slate-500" />
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-border bg-surface-0/90 backdrop-blur">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div>
              <p className="text-xs uppercase text-slate-500">Nestview v2</p>
              <h1 className="text-lg font-semibold text-slate-100 sm:text-xl">{activePage?.label ?? "Nestview"}</h1>
            </div>
            <div className="flex items-center gap-2">
              <FleetStatus running={running} total={total} />
              {authMode === "password" && onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  aria-label="Sign out"
                  title="Sign out"
                  className="rounded-lg border border-border bg-surface-1 p-2 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-100"
                >
                  <FiLogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
