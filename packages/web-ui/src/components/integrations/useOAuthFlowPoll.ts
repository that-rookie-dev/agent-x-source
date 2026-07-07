import { useEffect } from 'react';
import { integrations } from '../../api';

type OAuthPollResult = {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  message?: string;
};

/** Poll the server for OAuth completion — required when sign-in opens in the system browser (desktop). */
export function useOAuthFlowPoll(options: {
  enabled: boolean;
  state: string | null;
  onComplete: () => void;
  onFailed: (message: string) => void;
  poll?: (state: string) => Promise<{ result: OAuthPollResult }>;
}) {
  const { enabled, state, onComplete, onFailed, poll = integrations.oauthResult } = options;

  useEffect(() => {
    if (!enabled || !state) return;

    let cancelled = false;
    let settled = false;
    const tick = async () => {
      if (settled) return;
      try {
        const { result } = await poll(state);
        if (cancelled || settled) return;
        if (result.status === 'completed') {
          settled = true;
          onComplete();
        } else if (result.status === 'failed' || result.status === 'expired') {
          settled = true;
          onFailed(result.message ?? 'Sign-in did not complete. Click "Sign in again" to retry.');
        }
      } catch {
        /* ignore transient network errors while polling */
      }
    };

    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, state, onComplete, onFailed, poll]);
}
