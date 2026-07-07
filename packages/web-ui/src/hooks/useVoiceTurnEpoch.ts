import { useEffect, useRef, useState } from 'react';
import type { VoiceClientState } from '../voice/VoiceSessionClient';

/**
 * Increments on each voice ↔ response cycle so mission logs start fresh per turn.
 * - PTT: when STT submits (→ processing)
 * - Duplex: when STT submits (→ processing) or mic reopens after agent spoke (speaking → listening)
 */
export function useVoiceTurnEpoch(
  state: VoiceClientState,
  holding: boolean,
  enabled: boolean,
): number {
  const [epoch, setEpoch] = useState(0);
  const prevRef = useRef({ state, holding });

  useEffect(() => {
    if (!enabled) {
      prevRef.current = { state, holding };
      return;
    }

    const prev = prevRef.current;
    let bump = false;

    if (state === 'processing' && prev.state !== 'processing') {
      bump = true;
    }

    if (
      (state === 'ready' || state === 'idle')
      && (prev.state === 'speaking' || prev.state === 'processing')
    ) {
      bump = true;
    }

    if (
      state === 'listening'
      && !holding
      && prev.state === 'speaking'
    ) {
      bump = true;
    }

    if (bump) {
      setEpoch((n) => n + 1);
    }

    prevRef.current = { state, holding };
  }, [state, holding, enabled]);

  useEffect(() => {
    if (!enabled) {
      setEpoch(0);
      prevRef.current = { state: 'idle', holding: false };
    }
  }, [enabled]);

  return epoch;
}
