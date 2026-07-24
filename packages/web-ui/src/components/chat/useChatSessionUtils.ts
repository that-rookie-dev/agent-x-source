// Ensures an active session exists before send / crew operations.

import { useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { sessions } from '../../api';

export interface UseChatSessionUtilsInputs {
  navigate: NavigateFunction;
  setCurrentSessionId: (id: string | null) => void;
  setWarnings: (warnings: string[] | ((prev: string[]) => string[])) => void;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  skipRestoreRef: React.MutableRefObject<boolean>;
}

export function useChatSessionUtils({
  navigate,
  setCurrentSessionId,
  setWarnings,
  currentSessionIdRef,
  skipRestoreRef,
}: UseChatSessionUtilsInputs) {
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (currentSessionIdRef.current) return currentSessionIdRef.current;
    try {
      const result = await sessions.create();
      const newId = result?.sessionId;
      if (newId) {
        setCurrentSessionId(newId);
        currentSessionIdRef.current = newId;
        skipRestoreRef.current = true;
        navigate(`/console/chat/${newId}`);
        return newId;
      }
      setWarnings(['Failed to create session. Please try again.']);
    } catch (e) {
      setWarnings([`Failed to create session: ${e instanceof Error ? e.message : 'Unknown error'}`]);
    }
    return null;
  }, [navigate, currentSessionIdRef, setCurrentSessionId, skipRestoreRef, setWarnings]);

  return { ensureSession };
}
