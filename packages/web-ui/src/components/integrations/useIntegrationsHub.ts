import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connectionStatusRank } from './integration-ui';
import { isChannelCoveredMcpIntegration } from '@agentx/shared/browser';
import { integrations, type ConnectIntegrationRequest, type IntegrationAnalytics, type IntegrationConnection, type IntegrationProvider } from '../../api';

type OAuthBroadcast = {
  type?: string;
  success?: boolean;
  message?: string;
  connectionId?: string;
  providerId?: string;
};

export function useIntegrationsHub() {
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [analytics, setAnalytics] = useState<IntegrationAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Connection currently running post-auth / manual tool sync (drives loaders). */
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<IntegrationProvider | null>(null);
  const [detailProvider, setDetailProvider] = useState<IntegrationProvider | null>(null);
  const [signInOnOpen, setSignInOnOpen] = useState(false);
  const [message, setMessage] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const detailProviderRef = useRef<IntegrationProvider | null>(null);
  detailProviderRef.current = detailProvider;
  /** Dedupes OAuth broadcast + panel onSignedIn both firing after callback. */
  const authSyncInFlightRef = useRef<Promise<void> | null>(null);
  const lastAutoSyncRef = useRef<{ id: string; at: number } | null>(null);

  const applyCatalog = useCallback((
    catalog: { providers: IntegrationProvider[] },
    list: { connections: IntegrationConnection[] },
    stats: { analytics: IntegrationAnalytics } | null,
  ) => {
    setProviders(catalog.providers.filter((p) => !isChannelCoveredMcpIntegration(p.id)));
    setConnections(list.connections.filter((c) => !isChannelCoveredMcpIntegration(c.providerId)));
    setAnalytics(stats?.analytics ?? null);
  }, []);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      await integrations.maintain().catch(() => { /* best effort — stale status is still usable */ });
      const [catalog, list, stats] = await Promise.all([
        integrations.catalog(true),
        integrations.connections(),
        integrations.analytics().catch(() => null),
      ]);
      applyCatalog(catalog, list, stats);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [applyCatalog]);

  const handleSync = useCallback(async (connection: IntegrationConnection) => {
    setBusyId(connection.id);
    setSyncingId(connection.id);
    setMessage('Syncing tools…');
    // Optimistic UI: show Syncing chip while the request runs.
    setConnections((prev) => prev.map((c) => (
      c.id === connection.id ? { ...c, status: 'syncing', error: undefined } : c
    )));
    try {
      const { connection: synced } = await integrations.sync(connection.id);
      await refresh({ silent: true });
      const count = synced.toolCount ?? 0;
      if (synced.status === 'error') {
        setMessage(synced.error ?? 'Sync failed — check the connection and try again.');
      } else {
        setMessage(count > 0
          ? `Synced ${count} tool${count === 1 ? '' : 's'} from ${synced.displayName || 'MCP'}`
          : 'Connected — MCP reported no tools yet');
      }
      return synced;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sync failed');
      await refresh({ silent: true });
      throw e;
    } finally {
      setBusyId(null);
      setSyncingId(null);
    }
  }, [refresh]);

  /**
   * After OAuth / MCP callback succeeds: refresh list, then force a tool sync
   * so the toolkit picks up tools without a manual Sync click.
   */
  const handleAuthSuccess = useCallback(async (opts?: {
    connectionId?: string;
    providerId?: string;
  }) => {
    setMessage('Sign-in complete — syncing tools…');
    setConnectingProvider(null);
    await refresh({ silent: true });

    let targetId = opts?.connectionId;
    if (!targetId && opts?.providerId) {
      const list = await integrations.connections().catch(() => null);
      const match = list?.connections.find((c) => c.providerId === opts.providerId);
      targetId = match?.id;
    }
    if (!targetId) {
      const detail = detailProviderRef.current;
      if (detail) {
        const list = await integrations.connections().catch(() => null);
        targetId = list?.connections.find((c) => c.providerId === detail.id)?.id;
      }
    }
    if (!targetId) {
      setMessage('Signed in — open the integration and Sync if tools are missing.');
      return;
    }

    const recentlySynced = lastAutoSyncRef.current?.id === targetId
      && Date.now() - lastAutoSyncRef.current.at < 10_000;
    if (recentlySynced) return;
    if (authSyncInFlightRef.current) {
      await authSyncInFlightRef.current;
      if (lastAutoSyncRef.current?.id === targetId && Date.now() - lastAutoSyncRef.current.at < 10_000) {
        return;
      }
    }

    const stub: IntegrationConnection = {
      id: targetId,
      providerId: opts?.providerId ?? detailProviderRef.current?.id ?? '',
      displayName: '',
      status: 'syncing',
      enabled: true,
      authMode: 'oauth',
      connectedAt: new Date().toISOString(),
    };
    const run = (async () => {
      try {
        await handleSync(stub);
        lastAutoSyncRef.current = { id: targetId!, at: Date.now() };
      } catch {
        /* handleSync already set message */
      }
    })();
    authSyncInFlightRef.current = run.finally(() => {
      authSyncInFlightRef.current = null;
    });
    await authSyncInFlightRef.current;
  }, [handleSync, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onOAuthResult = (data: OAuthBroadcast) => {
      if (data?.type !== 'agentx-integration-oauth') return;
      if (data.success) {
        void handleAuthSuccess({
          connectionId: data.connectionId,
          providerId: data.providerId,
        });
      } else {
        // Keep the wizard open so the user can click "Sign in again".
        setMessage(data.message ?? 'Sign-in did not complete — you can retry from the wizard.');
      }
    };
    const onOAuthMessage = (event: MessageEvent) => onOAuthResult(event.data as OAuthBroadcast);
    window.addEventListener('message', onOAuthMessage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('agentx-integrations');
      channel.onmessage = (event) => onOAuthResult(event.data as OAuthBroadcast);
    } catch { /* BroadcastChannel unavailable */ }
    return () => {
      window.removeEventListener('message', onOAuthMessage);
      channel?.close();
    };
  }, [handleAuthSuccess]);

  const connectionByProvider = useMemo(() => {
    const map = new Map<string, IntegrationConnection>();
    for (const connection of connections) {
      const existing = map.get(connection.providerId);
      if (!existing || connectionStatusRank(connection.status) > connectionStatusRank(existing.status)) {
        map.set(connection.providerId, connection);
      }
    }
    return map;
  }, [connections]);

  const handleConnect = async (request: ConnectIntegrationRequest): Promise<IntegrationConnection> => {
    if (!connectingProvider) throw new Error('No provider selected');
    const connectedProvider = connectingProvider;
    setBusyId(connectedProvider.id);
    setMessage('');
    try {
      const { connection } = await integrations.connect(connectedProvider.id, request);
      setConnectingProvider(null);
      await refresh({ silent: true });
      if (connection.status === 'error') {
        setDetailProvider(connectedProvider);
        setMessage(connection.error ?? 'Connected, but the MCP server failed to start. Syncing again…');
        // Auto-retry sync once after a failed first handshake.
        try {
          await handleSync(connection);
        } catch { /* message already set */ }
        return connection;
      }
      // Fresh connect already lists tools server-side; still re-sync so the
      // toolkit bridge is guaranteed current and the UI shows Syncing… briefly.
      if (!connectedProvider.auth.packageSignIn && !connectedProvider.auth.mcpStdioAuth) {
        try {
          await handleSync(connection);
        } catch {
          setMessage('Connected — open Sync if tools do not appear.');
        }
      } else {
        setMessage('Connected — finish sign-in to sync tools.');
      }
      return connection;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Connect failed');
      throw e;
    } finally {
      setBusyId(null);
    }
  };

  const handleOAuthStart = async (remoteUrl?: string): Promise<{ state: string }> => {
    if (!connectingProvider) throw new Error('No provider selected');
    const { authUrl, state } = await integrations.startOAuth(connectingProvider.id, remoteUrl);
    const desktop = typeof window !== 'undefined' ? window.agentx : undefined;
    if (desktop?.openExternal) {
      await desktop.openExternal(authUrl);
    } else {
      window.open(authUrl, '_blank');
    }
    setMessage('Complete sign-in in the browser — tools will sync automatically when done.');
    return { state };
  };

  const handleImportFile = async (file: File) => {
    setMessage('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { mcpServers?: Record<string, unknown> };
      const result = await integrations.importMcp({ mcpServers: parsed.mcpServers as Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string }> });
      await refresh();
      setMessage(`Imported ${result.imported.length} server(s)${result.errors.length ? `, ${result.errors.length} failed` : ''}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed');
    }
  };

  const handleDisconnect = async (connection: IntegrationConnection) => {
    setBusyId(connection.id);
    setMessage('');
    try {
      await integrations.disconnect(connection.id);
      await refresh();
      setMessage('Disconnected');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setBusyId(null);
    }
  };

  const openDetail = (provider: IntegrationProvider) => {
    setSignInOnOpen(false);
    setDetailProvider(provider);
  };
  const openDetailForSignIn = (provider: IntegrationProvider) => {
    setSignInOnOpen(true);
    setDetailProvider(provider);
  };
  const closeDetail = () => {
    setDetailProvider(null);
    setSignInOnOpen(false);
  };
  const startConnect = (provider: IntegrationProvider) => {
    setDetailProvider(provider);
    setConnectingProvider(provider);
  };
  const cancelConnect = () => setConnectingProvider(null);

  return {
    providers,
    connections,
    analytics,
    loading,
    busyId,
    syncingId,
    connectingProvider,
    detailProvider,
    signInOnOpen,
    message,
    setMessage,
    importInputRef,
    connectionByProvider,
    refresh,
    handleConnect,
    handleOAuthStart,
    handleAuthSuccess,
    handleImportFile,
    handleDisconnect,
    handleSync,
    openDetail,
    openDetailForSignIn,
    closeDetail,
    startConnect,
    cancelConnect,
    setConnectingProvider,
    clearSignInOnOpen: () => setSignInOnOpen(false),
  };
}
