import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { auth, config, health, connectSSE, type AgentXConfig, type TelemetryEvent, type HealthStatus } from '../api';

type AppView = 'loading' | 'docking' | 'setup-auth' | 'setup-wizard' | 'login' | 'console';

interface AppState {
  view: AppView;
  authenticated: boolean;
  username: string | null;
  config: AgentXConfig | null;
  serverOnline: boolean;
  events: TelemetryEvent[];
  healthData: HealthStatus | null;
  // Actions
  setView: (v: AppView) => void;
  setAuthenticated: (v: boolean, username?: string) => void;
  setConfig: (c: AgentXConfig) => void;
  pushEvent: (e: TelemetryEvent) => void;
  refreshHealth: () => Promise<void>;
  initialize: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('loading');
  const [authenticated, setAuth] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [appConfig, setAppConfig] = useState<AgentXConfig | null>(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [healthData, setHealthData] = useState<HealthStatus | null>(null);

  const pushEvent = useCallback((e: TelemetryEvent) => {
    setEvents((prev) => [...prev.slice(-200), e]); // Keep last 200 events
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await health.check();
      setHealthData(h);
      setServerOnline(true);
    } catch {
      setServerOnline(false);
    }
  }, []);

  const setAuthenticated = useCallback((v: boolean, u?: string) => {
    setAuth(v);
    if (u) setUsername(u);
  }, []);

  const setConfig = useCallback((c: AgentXConfig) => { setAppConfig(c); }, []);

  const initialize = useCallback(async () => {
    setView('loading');
    try {
      // 1. Check if server is reachable
      await refreshHealth();

      // 2. Check auth state
      const authCheck = await auth.check();

      if (!authCheck.hasRootUser) {
        // Fresh install — need to create root user first
        setView('setup-auth');
        return;
      }

      // 3. Check if we have a valid session
      const authStatus = await auth.status();
      if (!authStatus.authenticated) {
        setView('login');
        return;
      }

      setAuth(true);
      setUsername(authStatus.username ?? null);

      // 4. Check setup status
      const setupStatus = await config.getSetupStatus();
      if (!setupStatus.setupComplete) {
        setView('setup-wizard');
        return;
      }

      // 5. Load config
      try {
        const cfg = await config.get();
        setAppConfig(cfg);
      } catch { /* proceed without config */ }

      // 6. Go to docking station
      setView('docking');
    } catch {
      // Server unreachable — show docking station with offline state
      setServerOnline(false);
      setView('docking');
    }
  }, [refreshHealth]);

  // Connect SSE when authenticated
  useEffect(() => {
    if (!authenticated) return;
    const disconnect = connectSSE(pushEvent);
    return disconnect;
  }, [authenticated, pushEvent]);

  const state: AppState = {
    view, authenticated, username, config: appConfig, serverOnline, events, healthData,
    setView, setAuthenticated, setConfig, pushEvent, refreshHealth, initialize,
  };

  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
