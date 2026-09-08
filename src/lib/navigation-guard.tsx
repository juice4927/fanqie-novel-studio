import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from "react";

type LeaveGuard = () => boolean;

const NavigationGuardContext = createContext({
  confirmNavigation: (): boolean => true,
  registerLeaveGuard:
    (_guard: LeaveGuard): (() => void) =>
    () => {},
});

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guardRef = useRef<LeaveGuard | null>(null);
  const confirmNavigation = useCallback(() => guardRef.current?.() ?? true, []);
  const registerLeaveGuard = useCallback((guard: LeaveGuard) => {
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) guardRef.current = null;
    };
  }, []);
  const value = useMemo(() => ({ confirmNavigation, registerLeaveGuard }), [confirmNavigation, registerLeaveGuard]);
  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>;
}

export const useNavigationGuard = () => useContext(NavigationGuardContext);
