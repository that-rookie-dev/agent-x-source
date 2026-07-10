import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { auth, config, health, setOnUnauthorized, setAuthToken, notifications, type AgentXConfig, type TelemetryEvent, type HealthStatus, type NotificationRecord } from '../api';
import { subscribeTelemetry } from '../telemetry-hub';
import { showAgentXNotification, requestBrowserNotificationPermission } from '../utils/native-notifications';
import { clearAgentxClientStorage } from '../utils/client-storage';

type AppView = 'loading' | 'docking' | 'setup-auth' | 'setup-wizard' | 'login' | 'console';
export type AuthState = 'loading' | 'no-root-user' | 'unauthenticated' | 'needs-setup' | 'authenticated';

interface AppState {
  view: AppView;
  authState: AuthState;
  authenticated: boolean;
  username: string | null;
  config: AgentXConfig | null;
  serverOnline: boolean;
  events: TelemetryEvent[];
  healthData: HealthStatus | null;
  unreadNotificationCount: number;
  refreshUnreadNotificationCount: () => Promise<void>;
  // Actions
  setView: (v: AppView) => void;
  setAuthenticated: (v: boolean, username?: string) => void;
  setAuthState: (s: AuthState) => void;
  setConfig: (c: AgentXConfig) => void;
  pushEvent: (e: TelemetryEvent) => void;
  refreshHealth: () => Promise<void>;
  initialize: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<AppView>('loading');
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [authenticated, setAuth] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [appConfig, setAppConfig] = useState<AgentXConfig | null>(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [healthData, setHealthData] = useState<HealthStatus | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  const refreshUnreadNotificationCount = useCallback(async () => {
    try {
      const { unreadCount } = await notifications.list({ limit: 1 });
      setUnreadNotificationCount(unreadCount);
    } catch {
      /* best-effort */
    }
  }, []);

  const pushEvent = useCallback((e: TelemetryEvent) => {
    if (e.type === 'notification_created') {
      const notification = e.notification as NotificationRecord | undefined;
      if (notification && notification.kind !== 'automation_scheduled') {
        void showAgentXNotification(notification);
        setUnreadNotificationCount((prev) => prev + 1);
      }
    }
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
    setAuthState(v ? 'authenticated' : 'unauthenticated');
  }, []);

  const setAuthStateDirect = useCallback((s: AuthState) => {
    setAuthState(s);
    if (s === 'authenticated' || s === 'needs-setup') setAuth(true);
    if (s === 'unauthenticated' || s === 'no-root-user') setAuth(false);
  }, []);

  const setConfig = useCallback((c: AgentXConfig) => { setAppConfig(c); }, []);

  // Token/session restoration happens in initialize() after server auth check.

  // Register unauthorized handler — any 401 response will reset auth state
  useEffect(() => {
    setOnUnauthorized(() => {
      setAuthToken(null);
      setAuthState('unauthenticated');
      setView('login');
      setAuth(false);
    });
    return () => setOnUnauthorized(null);
  }, []);

  const initialize = useCallback(async () => {
    setView('loading');
    setAuthState('loading');
    try {
      // 1. Check if server is reachable
      await refreshHealth();

      // 2. Check auth state
      const authCheck = await auth.check();

      if (!authCheck.hasRootUser) {
        // Fresh install — drop all stale browser state before root-user setup.
        clearAgentxClientStorage();
        setAuthToken(null);
        setAuthState('no-root-user');
        setView('setup-auth');
        return;
      }

      // 3. Check if we have a valid session (must include unlocked DEK after server restart)
      const authStatus = await auth.status();
      if (!authStatus.isAuthenticated) {
        setAuthToken(null);
        setAuthState('unauthenticated');
        setView('login');
        return;
      }

      if (authStatus.sessionToken) {
        setAuthToken(authStatus.sessionToken);
      }

      setAuth(true);
      setUsername(authStatus.username ?? null);

      // 4. Check setup status
      const setupStatus = await config.getSetupStatus();
      if (!setupStatus.setupComplete) {
        setAuthState('needs-setup');
        setView('setup-wizard');
        return;
      }

      // 5. Load config
      try {
        const cfg = await config.get();
        setAppConfig(cfg);
      } catch { /* proceed without config */ }

      // 6. All good
      setAuthState('authenticated');
      setView('docking');
    } catch (err) {
      if (err instanceof Error && err.message === 'Unauthorized') {
        // Auth token invalid/expired — onUnauthorized handler already set
        // authState='unauthenticated' and view='login'. Don't override those.
        return;
      }
      // Server unreachable — show docking station with offline state
      setServerOnline(false);
      setAuthState('authenticated');
      setView('docking');
    }
  }, [refreshHealth]);

  // Connect SSE when authenticated
  useEffect(() => {
    if (authState !== 'authenticated') return;
    const disconnect = subscribeTelemetry(pushEvent);
    void refreshUnreadNotificationCount();
    if (!window.agentx?.isDesktop) {
      void requestBrowserNotificationPermission();
    }
    return disconnect;
  }, [authState, pushEvent, refreshUnreadNotificationCount]);

  // Load config when authenticated (e.g. after login, when initialize() isn't called)
  useEffect(() => {
    if (authState !== 'authenticated' || appConfig) return;
    config.get().then((cfg) => setAppConfig(cfg)).catch(() => {});
  }, [authState, appConfig]);

  // Memoize the provider value so consumers don't re-render when an unrelated
  // parent render recreates this object.
  const state: AppState = useMemo(() => ({
    view, authState, authenticated, username, config: appConfig, serverOnline, events, healthData,
    unreadNotificationCount, refreshUnreadNotificationCount,
    setView, setAuthenticated, setAuthState: setAuthStateDirect, setConfig, pushEvent, refreshHealth, initialize,
  }), [
    view, authState, authenticated, username, appConfig, serverOnline, events, healthData,
    unreadNotificationCount, refreshUnreadNotificationCount,
    setAuthenticated, setAuthStateDirect, setConfig, pushEvent, refreshHealth, initialize,
  ]);

  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
