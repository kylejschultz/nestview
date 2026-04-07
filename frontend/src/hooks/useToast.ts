import { useCallback, useState } from "react";

export interface ToastState {
  message: string;
  type: "success" | "error";
  duration?: number;
  id: number;
}

let _nextId = 0;

export function useToast() {
  const [toastState, setToastState] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (message: string, type: "success" | "error", duration?: number) => {
      setToastState({ message, type, duration, id: ++_nextId });
    },
    []
  );

  const dismissToast = useCallback(() => setToastState(null), []);

  return { toastState, showToast, dismissToast };
}
