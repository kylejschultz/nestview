import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Dashboard from "./pages/Dashboard";
import ContainerDetail from "./pages/ContainerDetail";
import Settings from "./pages/Settings";
import Header from "./components/Header";
import SetupWizard from "./components/SetupWizard";
import { api } from "./api";
import type { WizardStatus } from "./types";

export default function App() {
  // Once the wizard is dismissed in this session, don't re-show it without a reload.
  const [wizardDismissed, setWizardDismissed] = useState(false);

  const { data: wizardStatus } = useQuery<WizardStatus>({
    queryKey: ["wizard-status"],
    queryFn: api.settings.wizard,
    staleTime: Infinity,
  });

  const showWizard = !wizardDismissed && wizardStatus !== undefined && !wizardStatus.completed;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 px-4 py-6 max-w-7xl mx-auto w-full">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/containers/:id" element={<ContainerDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      {showWizard && <SetupWizard onDone={() => setWizardDismissed(true)} />}
    </div>
  );
}
