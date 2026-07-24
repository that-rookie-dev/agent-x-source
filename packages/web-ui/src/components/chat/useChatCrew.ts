// useChatCrew.ts — extracted from useChatSessionState.tsx
// Owns crew worker/mission state for the sidebar (display + open child session only).

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { CrewWorkerState } from '../CrewWorkerPanel';
import type { CrewInterMessage } from '../CrewMissionCard';

export interface UseChatCrewInputs {
  currentSessionId: string | null;
  currentSessionIdRef: React.MutableRefObject<string | null>;
}

export function useChatCrew({
  currentSessionId,
  currentSessionIdRef,
}: UseChatCrewInputs) {
  // ─── Crew mission state ───
  const [crewWorkers, setCrewWorkers] = useState<CrewWorkerState[]>([]);
  const [crewMissionActive, setCrewMissionActive] = useState(false);
  const [crewMissionId, setCrewMissionId] = useState<string | null>(null);
  const [crewInterMessages, setCrewInterMessages] = useState<CrewInterMessage[]>([]);
  const crewMissionSessionIdRef = useRef<string | null>(null);

  // ─── resetCrewMissionState ───
  const resetCrewMissionState = useCallback(() => {
    setCrewWorkers([]);
    setCrewMissionActive(false);
    setCrewMissionId(null);
    setCrewInterMessages([]);
    crewMissionSessionIdRef.current = null;
  }, []);

  // ─── isCrewEventForCurrentSession ───
  const isCrewEventForCurrentSession = useCallback(() => {
    const bound = crewMissionSessionIdRef.current;
    const current = currentSessionIdRef.current;
    return bound != null && current != null && bound === current;
  }, [currentSessionIdRef]);

  // ─── Reset crew mission state on session change ───
  useEffect(() => { resetCrewMissionState(); }, [currentSessionId, resetCrewMissionState]);

  return {
    // Crew mission state
    crewWorkers, setCrewWorkers,
    crewMissionActive, setCrewMissionActive,
    crewMissionId, setCrewMissionId,
    crewInterMessages, setCrewInterMessages,
    crewMissionSessionIdRef,
    resetCrewMissionState,
    isCrewEventForCurrentSession,
  };
}
