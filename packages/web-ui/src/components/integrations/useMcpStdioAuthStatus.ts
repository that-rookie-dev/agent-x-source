import { useEffect, useState } from 'react';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { integrations } from '../../api';
import { providerMcpStdioAuth } from './integration-ui';

export type McpStdioAuthUiStatus = 'idle' | 'checking' | 'signed_in' | 'signed_out' | 'failed';

export function useMcpStdioAuthStatus(provider: IntegrationProvider, connection?: IntegrationConnection) {
  const mcpStdioAuth = providerMcpStdioAuth(provider);
  const [status, setStatus] = useState<McpStdioAuthUiStatus>(() => (
    mcpStdioAuth && connection ? 'checking' : 'idle'
  ));

  useEffect(() => {
    if (!mcpStdioAuth || !connection) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('checking');
    void integrations.mcpAuthStatus(connection.id)
      .then((result) => {
        if (!cancelled) setStatus(result.signedIn ? 'signed_in' : 'signed_out');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });

    return () => { cancelled = true; };
  }, [connection?.id, connection?.status, mcpStdioAuth]);

  const refresh = async (): Promise<boolean> => {
    if (!mcpStdioAuth || !connection) return false;
    setStatus('checking');
    try {
      const result = await integrations.mcpAuthStatus(connection.id);
      setStatus(result.signedIn ? 'signed_in' : 'signed_out');
      return result.signedIn;
    } catch {
      setStatus('failed');
      return false;
    }
  };

  return {
    mcpStdioAuth,
    status,
    setStatus,
    refresh,
    isChecking: status === 'checking',
    isSignedIn: status === 'signed_in',
    needsSignIn: Boolean(mcpStdioAuth && connection && status === 'signed_out'),
  };
}
