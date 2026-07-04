import { useEffect } from 'react';
import { integrations } from '../../api';

/** Poll the server for OAuth completion — required when sign-in opens in the system browser (desktop). */
export function useOAuthFlowPoll(options: {
  enabled: boolean;
  state: string | null;
  onComplete: () => void;
  onFailed: (message: string) => void;
}) {
  const { enabled, state, onComplete, onFailed } = options;

  useEffect(() => {
    if (!enabled || !state) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const { result } = await integrations.oauthResult(state);
        if (cancelled) return;
        if (result.status === 'completed') {
          onComplete();
        } else if (result.status === 'failed' || result.status === 'expired') {
          onFailed(result.message ?? 'Sign-in did not complete. Click "Sign in again" to retry.');
        }
      } catch {
        /* ignore transient network errors while polling */
      }
    };

    void poll();
    const id = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, state, onComplete, onFailed]);
}
