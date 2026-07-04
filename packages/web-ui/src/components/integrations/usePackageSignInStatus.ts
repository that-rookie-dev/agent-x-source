import { useEffect, useState } from 'react';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { checkPackageSignInStatus, isNotConnectedResult } from './package-sign-in-status';
import { isInstalledConnection, providerPackageSignIn } from './integration-ui';

export type PackageSignInUiStatus = 'idle' | 'checking' | 'signed_in' | 'signed_out' | 'failed';

export function usePackageSignInStatus(provider: IntegrationProvider, connection?: IntegrationConnection) {
  const signIn = providerPackageSignIn(provider);
  const [status, setStatus] = useState<PackageSignInUiStatus>(() => (
    signIn?.statusTool && connection && isInstalledConnection(connection) ? 'checking' : 'idle'
  ));

  useEffect(() => {
    if (!signIn?.statusTool || !connection || !isInstalledConnection(connection)) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('checking');
    void checkPackageSignInStatus(connection.id, signIn.statusTool)
      .then((signedIn) => {
        if (!cancelled) setStatus(signedIn ? 'signed_in' : 'signed_out');
      })
      .catch(() => {
        if (!cancelled) setStatus('signed_out');
      });

    return () => { cancelled = true; };
  }, [connection?.id, connection?.status, signIn?.statusTool]);

  const refresh = async (): Promise<boolean> => {
    if (!signIn?.statusTool || !connection) return false;
    setStatus('checking');
    try {
      const signedIn = await checkPackageSignInStatus(connection.id, signIn.statusTool);
      setStatus(signedIn ? 'signed_in' : 'signed_out');
      return signedIn;
    } catch {
      setStatus('signed_out');
      return false;
    }
  };

  return {
    signIn,
    status,
    setStatus,
    refresh,
    isChecking: status === 'checking',
    isSignedIn: status === 'signed_in',
    needsSignIn: Boolean(signIn?.statusTool) && status === 'signed_out',
    isNotConnectedResult,
  };
}
