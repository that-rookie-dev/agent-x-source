import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { auth, config, health, setOnUnauthorized, setAuthToken, notifications, type AgentXConfig, type TelemetryEvent, type HealthStatus, type NotificationRecord } from '../api';
import { subscribeTelemetry } from '../telemetry-hub';
import { shouldAppendToAppContextEvents } from '../perf/telemetry-event-filter';
import { cachedApiCall, invalidateApiCache, invalidateCoreSessionCache } from '../perf/api-cache';
import { showAgentXNotification, requestBrowserNotificationPermission } from '../utils/native-notifications';
import { clearAgentxClientStorage } from '../utils/client-storage';

type AppView = 'loading' | 'docking' | 'setup-auth' | 'setup-wizard' | 'login' | 'console';
export type AuthState = 'loading' | 'no-root-user' | 'unauthenticated' | 'needs-setup' | 'authenticated';

/** Stable session / identity / config — changes rarely. */
export interface AppCoreState {
  view: AppView;
  authState: AuthState;
  authenticated: boolean;
  username: string | null;
  config: AgentXConfig | null;
  setView: (v: AppView) => void;
  setAuthenticated: (v: boolean, username?: string) => void;
  setAuthState: (s: AuthState) => void;
  setConfig: (c: AgentXConfig) => void;
  initialize: () => Promise<void>;
}

/** Volatile live signals — health, SSE events, notification badges. */
export interface AppLiveState {
  serverOnline: boolean;
  events: TelemetryEvent[];
  healthData: HealthStatus | null;
  unreadNotificationCount: number;
  refreshUnreadNotificationCount: () => Promise<void>;
  pushEvent: (e: TelemetryEvent) => void;
  refreshHealth: () => Promise<void>;
}

export type AppState = AppCoreState & AppLiveState;

const AppCoreContext = createContext<AppCoreState | null>(null);
const AppLiveContext = createContext<AppLiveState | null>(null);

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
    if (shouldAppendToAppContextEvents(e)) {
      setEvents((prev) => [...prev.slice(-200), e]);
    }
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

  useEffect(() => {
    setOnUnauthorized(() => {
      setAuthToken(null);
      invalidateApiCache();
      invalidateCoreSessionCache();
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
      await refreshHealth();

      const authCheck = await auth.check();

      if (!authCheck.hasRootUser) {
        clearAgentxClientStorage();
        setAuthToken(null);
        invalidateApiCache();
        invalidateCoreSessionCache();
        setAuthState('no-root-user');
        setView('setup-auth');
        return;
      }

      const [authStatus, setupStatus] = await Promise.all([
        auth.status(),
        config.getSetupStatus(),
      ]);

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

      if (!setupStatus.setupComplete) {
        setAuthState('needs-setup');
        setView('setup-wizard');
        return;
      }

      try {
        const cfg = await cachedApiCall('config', () => config.get(), 60_000);
        setAppConfig(cfg);
      } catch { /* proceed without config */ }

      setAuthState('authenticated');
      setView('docking');
    } catch (err) {
      if (err instanceof Error && err.message === 'Unauthorized') {
        return;
      }
      setServerOnline(false);
      setAuthState('authenticated');
      setView('docking');
    }
  }, [refreshHealth]);

  useEffect(() => {
    if (authState !== 'authenticated') return;
    const disconnect = subscribeTelemetry(pushEvent);
    void refreshUnreadNotificationCount();
    if (!window.agentx?.isDesktop) {
      void requestBrowserNotificationPermission();
    }
    return disconnect;
  }, [authState, pushEvent, refreshUnreadNotificationCount]);

  useEffect(() => {
    if (authState !== 'authenticated' || appConfig) return;
    cachedApiCall('config', () => config.get(), 60_000).then((cfg) => setAppConfig(cfg)).catch(() => {});
  }, [authState, appConfig]);

  const core: AppCoreState = useMemo(() => ({
    view,
    authState,
    authenticated,
    username,
    config: appConfig,
    setView,
    setAuthenticated,
    setAuthState: setAuthStateDirect,
    setConfig,
    initialize,
  }), [
    view, authState, authenticated, username, appConfig,
    setAuthenticated, setAuthStateDirect, setConfig, initialize,
  ]);

  const live: AppLiveState = useMemo(() => ({
    serverOnline,
    events,
    healthData,
    unreadNotificationCount,
    refreshUnreadNotificationCount,
    pushEvent,
    refreshHealth,
  }), [
    serverOnline, events, healthData, unreadNotificationCount,
    refreshUnreadNotificationCount, pushEvent, refreshHealth,
  ]);

  return (
    <AppCoreContext.Provider value={core}>
      <AppLiveContext.Provider value={live}>
        {children}
      </AppLiveContext.Provider>
    </AppCoreContext.Provider>
  );
}

/** Prefer selective hooks (`useAppCore` / `useAppLive`) in hot paths. */
export function useApp(): AppState {
  const core = useContext(AppCoreContext);
  const live = useContext(AppLiveContext);
  if (!core || !live) throw new Error('useApp must be inside AppProvider');
  return useMemo(() => ({ ...core, ...live }), [core, live]);
}

export function useAppCore(): AppCoreState {
  const ctx = useContext(AppCoreContext);
  if (!ctx) throw new Error('useAppCore must be inside AppProvider');
  return ctx;
}

export function useAppLive(): AppLiveState {
  const ctx = useContext(AppLiveContext);
  if (!ctx) throw new Error('useAppLive must be inside AppProvider');
  return ctx;
}
