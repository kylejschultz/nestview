import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { GeneralSettings } from "./types";

const TimezoneContext = createContext<string>("UTC");

export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const { data: general } = useQuery<GeneralSettings>({
    queryKey: ["settings-general"],
    queryFn: api.settings.general,
    staleTime: 60_000,
  });

  return (
    <TimezoneContext.Provider value={general?.timezone ?? "UTC"}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone(): string {
  return useContext(TimezoneContext);
}
