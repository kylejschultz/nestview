import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Dashboard from "./pages/Dashboard";
import ContainerDetail from "./pages/ContainerDetail";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";
import Header from "./components/Header";
import SetupWizard from "./components/SetupWizard";
import { TimezoneProvider } from "./TimezoneContext";
import { api } from "./api";
import type { AuthStatus, WizardStatus } from "./types";

export default function App() {
  const queryClient = useQueryClient();

  // Once the wizard is dismissed in this session, don't re-show it without a reload.
  const [wizardDismissed, setWizardDismissed] = useState(false);

  const { data: authStatus, isLoading: authLoading } = useQuery<AuthStatus>({
    queryKey: ["auth-status"],
    queryFn: api.auth.status,
    staleTime: Infinity,
    retry: false,
  });

  const { data: wizardStatus } = useQuery<WizardStatus>({
    queryKey: ["wizard-status"],
    queryFn: api.settings.wizard,
    staleTime: Infinity,
    enabled: authStatus !== undefined && !authStatus.setup_required,
  });

  const showWizard = !wizardDismissed && wizardStatus !== undefined && !wizardStatus.completed;

  // Loading: auth status not yet fetched
  if (authLoading) {
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

  // Normal: full app
  return (
    <TimezoneProvider>
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 px-4 py-6 max-w-7xl mx-auto w-full">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/containers/:id" element={<ContainerDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/setup" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        {showWizard && <SetupWizard onDone={() => setWizardDismissed(true)} />}
      </div>
    </TimezoneProvider>
  );
}
