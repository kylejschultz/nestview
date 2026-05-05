import { useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Dashboard from "./pages/Dashboard";
import ContainerDetail from "./pages/ContainerDetail";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";
import Login from "./pages/Login";
import Header from "./components/Header";
import SetupWizard from "./components/SetupWizard";
import AnalyticsPromptModal from "./components/AnalyticsPromptModal";
import { TimezoneProvider } from "./TimezoneContext";
import { AuthContext } from "./AuthContext";
import { api } from "./api";
import type { AuthStatus, MeResponse, WizardStatus } from "./types";

export default function App() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Once the wizard is dismissed in this session, don't re-show it without a reload.
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [analyticsModalDismissed, setAnalyticsModalDismissed] = useState(false);

  const { data: authStatus, isLoading: authStatusLoading } = useQuery<AuthStatus>({
    queryKey: ["auth-status"],
    queryFn: api.auth.status,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  const meEnabled = !authStatus?.setup_required && authStatus?.auth_mode === "password";

  const { data: meData, isLoading: meLoading } = useQuery<MeResponse | null>({
    queryKey: ["auth-me"],
    queryFn: async () => {
      try {
        return await api.auth.me();
      } catch {
        return null;
      }
    },
    enabled: meEnabled,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

  const { data: wizardStatus } = useQuery<WizardStatus>({
    queryKey: ["wizard-status"],
    queryFn: api.settings.wizard,
    staleTime: Infinity,
    enabled: authStatus !== undefined && !authStatus.setup_required && (meData?.authenticated === true),
  });

  const showWizard = !wizardDismissed && wizardStatus !== undefined && !wizardStatus.completed;

  const isAuthed = authStatus?.auth_mode === "none" || meData?.authenticated === true;

  const { data: allSettings } = useQuery<Record<string, string>>({
    queryKey: ["settings-all"],
    queryFn: api.settings.getAll,
    enabled: isAuthed && wizardStatus?.completed === true,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  async function handleLogin() {
    await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    navigate("/", { replace: true });
  }

  async function handleLogout() {
    try {
      await api.auth.logout();
    } finally {
      queryClient.removeQueries({ queryKey: ["auth-me"] });
      navigate("/login", { replace: true });
    }
  }

  // Loading: auth status or session check not yet fetched
  if (authStatusLoading || (meEnabled && meLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-1">
        <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  // Setup required: render only the setup page
  if (authStatus?.setup_required) {
    return (
      <Setup
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["auth-status"] });
        }}
      />
    );
  }

  // Authenticated: auth_mode "none" bypasses auth entirely; "password" requires a valid session
  const isAuthenticated = authStatus?.auth_mode === "none" || meData?.authenticated === true;

  const showAnalyticsModal =
    !analyticsModalDismissed &&
    isAuthenticated &&
    !showWizard &&
    wizardStatus?.completed === true &&
    allSettings?.["analytics_enabled"] !== "true" &&
    allSettings?.["analytics_prompt_seen"] !== "true";

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Full app (auth_mode "none" or authenticated)
  return (
    <AuthContext.Provider value={{ isAuthenticated }}>
      <TimezoneProvider>
        <div className="min-h-screen flex flex-col">
          <Header onLogout={handleLogout} authMode={authStatus?.auth_mode} />
          <main className="flex-1 px-4 py-6 max-w-7xl mx-auto w-full">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/containers/:id" element={<ContainerDetail />} />
              <Route path="/settings" element={<Settings authMode={authStatus?.auth_mode} />} />
              <Route path="/setup" element={<Navigate to="/" replace />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          {showWizard && <SetupWizard onDone={() => setWizardDismissed(true)} />}
          {showAnalyticsModal && <AnalyticsPromptModal onClose={() => setAnalyticsModalDismissed(true)} />}
        </div>
      </TimezoneProvider>
    </AuthContext.Provider>
  );
}
