import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Dashboard from "./pages/Dashboard";
import ContainerDetail from "./pages/ContainerDetail";
import Settings from "./pages/Settings";
import Header from "./components/Header";
import SetupWizard from "./components/SetupWizard";
import ApiKeyPrompt from "./components/ApiKeyPrompt";
import { TimezoneProvider } from "./TimezoneContext";
import { api, getApiKey } from "./api";
import type { WizardStatus } from "./types";

export default function App() {
  // Once the wizard is dismissed in this session, don't re-show it without a reload.
  const [wizardDismissed, setWizardDismissed] = useState(false);

  // API key auth state — set to true when NESTVIEW_API_KEY is configured on the
  // server and no key is stored in sessionStorage yet.
  const [showApiKeyPrompt, setShowApiKeyPrompt] = useState(false);
  // Track whether config has been checked so we don't flash content before auth.
  const [configChecked, setConfigChecked] = useState(false);

  useEffect(() => {
    api.config().then(({ api_key_required }) => {
      if (api_key_required && !getApiKey()) {
        setShowApiKeyPrompt(true);
      }
      setConfigChecked(true);
    }).catch(() => {
      // If config fetch fails, proceed without auth (backend may not support it yet).
      setConfigChecked(true);
    });
  }, []);

  // Re-show the prompt if any request returns 401/403 (key wrong or expired).
  useEffect(() => {
    const handler = () => setShowApiKeyPrompt(true);
    window.addEventListener("nestview:auth-required", handler);
    return () => window.removeEventListener("nestview:auth-required", handler);
  }, []);

  const { data: wizardStatus } = useQuery<WizardStatus>({
    queryKey: ["wizard-status"],
    queryFn: api.settings.wizard,
    staleTime: Infinity,
    // Don't fetch until the auth state is resolved.
    enabled: configChecked && !showApiKeyPrompt,
  });

  const showWizard = !wizardDismissed && wizardStatus !== undefined && !wizardStatus.completed;

  if (!configChecked) {
    return null;
  }

  return (
    <TimezoneProvider>
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
        {showApiKeyPrompt && (
          <ApiKeyPrompt onUnlocked={() => setShowApiKeyPrompt(false)} />
        )}
      </div>
    </TimezoneProvider>
  );
}
