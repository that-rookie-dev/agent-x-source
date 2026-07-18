import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connectionStatusRank } from './integration-ui';
import { isChannelCoveredMcpIntegration } from '@agentx/shared/browser';
import { integrations, type ConnectIntegrationRequest, type IntegrationAnalytics, type IntegrationConnection, type IntegrationProvider } from '../../api';

export function useIntegrationsHub() {
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [analytics, setAnalytics] = useState<IntegrationAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<IntegrationProvider | null>(null);
  const [detailProvider, setDetailProvider] = useState<IntegrationProvider | null>(null);
  const [signInOnOpen, setSignInOnOpen] = useState(false);
  const [message, setMessage] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await integrations.maintain().catch(() => { /* best effort — stale status is still usable */ });
      const [catalog, list, stats] = await Promise.all([
        integrations.catalog(true),
        integrations.connections(),
        integrations.analytics().catch(() => null),
      ]);
      setProviders(catalog.providers.filter((p) => !isChannelCoveredMcpIntegration(p.id)));
      setConnections(list.connections.filter((c) => !isChannelCoveredMcpIntegration(c.providerId)));
      setAnalytics(stats?.analytics ?? null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onOAuthResult = (data: { type?: string; success?: boolean; message?: string }) => {
      if (data?.type !== 'agentx-integration-oauth') return;
      if (data.success) {
        void refresh();
        setMessage('OAuth connected — integrations refreshed.');
        setConnectingProvider(null);
      } else {
        // Keep the wizard open so the user can click "Sign in again".
        setMessage(data.message ?? 'Sign-in did not complete — you can retry from the wizard.');
      }
    };
    const onOAuthMessage = (event: MessageEvent) => onOAuthResult(event.data);
    window.addEventListener('message', onOAuthMessage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('agentx-integrations');
      channel.onmessage = (event) => onOAuthResult(event.data);
    } catch { /* BroadcastChannel unavailable */ }
    return () => {
      window.removeEventListener('message', onOAuthMessage);
      channel?.close();
    };
  }, [refresh]);

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
      await refresh();
      if (connection.status === 'error') {
        setDetailProvider(connectedProvider);
        setMessage(connection.error ?? 'Connected, but the MCP server failed to start. Use Sync to retry.');
        return connection;
      }
      if (!connectedProvider.auth.packageSignIn) {
        setMessage('Connected successfully');
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
    setMessage('Complete sign-in in the browser — this page will update automatically.');
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

  const handleSync = async (connection: IntegrationConnection) => {
    setBusyId(connection.id);
    setMessage('');
    try {
      await integrations.sync(connection.id);
      await refresh();
      setMessage('Tools synced');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Sync failed');
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
