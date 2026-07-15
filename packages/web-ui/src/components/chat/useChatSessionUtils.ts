// useChatSessionUtils.ts — small helper hook for shared session utilities.
// Ensures a default working directory and an active session exist before operations
// that require them (sending messages, crew operations, etc.).

import { useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { resolveDefaultWorkspace } from '../../utils/default-workspace';
import { sessions, system } from '../../api';

export interface UseChatSessionUtilsInputs {
  navigate: NavigateFunction;
  setCwd: (cwd: string) => void;
  setCurrentSessionId: (id: string | null) => void;
  setWarnings: (warnings: string[] | ((prev: string[]) => string[])) => void;
  cwdRef: React.MutableRefObject<string>;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  skipRestoreRef: React.MutableRefObject<boolean>;
}

export function useChatSessionUtils({
  navigate,
  setCwd,
  setCurrentSessionId,
  setWarnings,
  cwdRef,
  currentSessionIdRef,
  skipRestoreRef,
}: UseChatSessionUtilsInputs) {
  const ensureDefaultCwd = useCallback(async (): Promise<string> => {
    if (cwdRef.current) return cwdRef.current;
    const folder = await resolveDefaultWorkspace();
    setCwd(folder);
    cwdRef.current = folder;
    try {
      await system.setCwd(folder);
    } catch { /* best-effort */ }
    return folder;
  }, []);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (currentSessionIdRef.current) return currentSessionIdRef.current;
    const scopePath = await ensureDefaultCwd();
    try {
      const result = await sessions.create(scopePath);
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
  }, [navigate, ensureDefaultCwd]);

  return { ensureDefaultCwd, ensureSession };
}
