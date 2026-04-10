import { createContext, useContext } from "react";

interface AuthContextValue {
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextValue>({ isAuthenticated: false });

export function useAuth() {
  return useContext(AuthContext);
}
