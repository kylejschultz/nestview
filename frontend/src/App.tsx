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
import { TimezoneProvider } from "./TimezoneContext";
import { api } from "./api";
import type { AuthStatus, MeResponse, WizardStatus } from "./types";

export default function App() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Once the wizard is dismissed in this session, don't re-show it without a reload.
  const [wizardDismissed, setWizardDismissed] = useState(false);

  const { data: authStatus, isLoading: authStatusLoading } = useQuery<AuthStatus>({
    queryKey: ["auth-status"],
    queryFn: api.auth.status,
    staleTime: Infinity,
    retry: false,
  });

  const { data: meData, isLoading: meLoading } = useQuery<MeResponse>({
    queryKey: ["auth-me"],
    queryFn: api.auth.me,
    staleTime: Infinity,
    retry: false,
    enabled: authStatus !== undefined && !authStatus.setup_required,
  });

  const { data: wizardStatus } = useQuery<WizardStatus>({
    queryKey: ["wizard-status"],
    queryFn: api.settings.wizard,
    staleTime: Infinity,
    enabled: authStatus !== undefined && !authStatus.setup_required && (meData?.authenticated === true),
  });

  const showWizard = !wizardDismissed && wizardStatus !== undefined && !wizardStatus.completed;

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

  const meEnabled = !authStatus?.setup_required && authStatus?.auth_mode === "password";

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
    <TimezoneProvider>
      <div className="min-h-screen flex flex-col">
        <Header onLogout={handleLogout} authMode={authStatus?.auth_mode} />
        <main className="flex-1 px-4 py-6 max-w-7xl mx-auto w-full">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/containers/:id" element={<ContainerDetail />} />
            <Route path="/settings" element={<Settings authMode={authStatus?.auth_mode} />} />
            <Route path="/setup" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        {showWizard && <SetupWizard onDone={() => setWizardDismissed(true)} />}
      </div>
    </TimezoneProvider>
  );
}
