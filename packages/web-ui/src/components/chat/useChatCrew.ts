// useChatCrew.ts — extracted from useChatSessionState.tsx
// Owns crew worker/mission state, crew add/search UI state, and crew management handlers.
// Moderate coupling: needs currentSessionId, currentSessionIdRef, ensureSession, setCrewList, setWarnings.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { crews, crewSuggestions, crewCatalog, type CatalogSummary, type CrewMatchCandidate, type Crew } from '../../api';
import { replaceWarning } from './message-helpers';
import type { CrewWorkerState } from '../CrewWorkerPanel';
import type { CrewInterMessage } from '../CrewMissionCard';

export interface UseChatCrewInputs {
  currentSessionId: string | null;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  ensureSession: () => Promise<string | null>;
  setCrewList: React.Dispatch<React.SetStateAction<Crew[]>>;
  setWarnings: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useChatCrew({
  currentSessionId,
  currentSessionIdRef,
  ensureSession,
  setCrewList,
  setWarnings,
}: UseChatCrewInputs) {
  // ─── Crew mission state ───
  const [crewWorkers, setCrewWorkers] = useState<CrewWorkerState[]>([]);
  const [crewMissionActive, setCrewMissionActive] = useState(false);
  const [crewMissionId, setCrewMissionId] = useState<string | null>(null);
  const [crewInterMessages, setCrewInterMessages] = useState<CrewInterMessage[]>([]);
  const crewMissionSessionIdRef = useRef<string | null>(null);

  // ─── Crew add/search UI state ───
  const [crewAddQuery, setCrewAddQuery] = useState('');
  const [crewAddResults, setCrewAddResults] = useState<CatalogSummary[]>([]);
  const [crewAddOpen, setCrewAddOpen] = useState(false);
  const [crewAddLoading, setCrewAddLoading] = useState(false);
  const crewAddSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── handleCrewAddSearch ───
  const handleCrewAddSearch = useCallback((q: string) => {
    setCrewAddQuery(q);
    if (crewAddSearchRef.current) clearTimeout(crewAddSearchRef.current);
    if (q.trim().length < 2) {
      setCrewAddResults([]);
      setCrewAddLoading(false);
      return;
    }
    setCrewAddLoading(true);
    crewAddSearchRef.current = setTimeout(async () => {
      try {
        const res = await crewCatalog.search(q.trim(), 8);
        setCrewAddResults(res.crews ?? []);
      } catch {
        setCrewAddResults([]);
      } finally {
        setCrewAddLoading(false);
      }
    }, 250);
  }, []);

  // ─── handleCrewAddSelect ───
  const handleCrewAddSelect = useCallback(async (entry: CatalogSummary) => {
    setCrewAddOpen(false);
    setCrewAddQuery('');
    setCrewAddResults([]);
    try {
      const sessionId = await ensureSession();
      if (!sessionId) return;
      const candidate: CrewMatchCandidate = {
        id: entry.id,
        origin: 'hub_catalog',
        callsign: entry.callsign,
        name: entry.name,
        title: entry.title,
        categoryId: entry.categoryId,
        categoryLabel: entry.categoryLabel,
        description: entry.description,
        expertise: entry.expertise,
        traits: entry.traits,
        tone: entry.tone,
        matchScore: 1,
        reasons: ['manual-add'],
        onRoster: false,
        catalogId: entry.id,
        requiresMedicalDisclaimer: entry.requiresMedicalDisclaimer,
        honorsDoctorate: entry.honorsDoctorate,
      };
      await crewSuggestions.resolve({
        sessionId,
        action: 'deploy',
        selectedCandidateIds: [entry.id],
        candidates: [candidate],
      });
      crews.list().then((list) => setCrewList(list)).catch(() => {});
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : 'Failed to add crew member'));
    }
  }, [ensureSession, setCrewList, setWarnings]);

  // ─── handleCrewRemove ───
  const handleCrewRemove = useCallback(async (crewId: string, crewName: string) => {
    try {
      await crews.toggle(crewId, false);
      crews.list().then((list) => setCrewList(list)).catch(() => {});
      setCrewWorkers((prev) => prev.filter((w) => w.crewId !== crewId));
    } catch (err) {
      setWarnings((prev) => replaceWarning(prev, err instanceof Error ? err.message : `Failed to remove ${crewName}`));
    }
  }, [setCrewList, setCrewWorkers, setWarnings]);

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
    // Crew add/search UI state
    crewAddQuery, setCrewAddQuery,
    crewAddResults, setCrewAddResults,
    crewAddOpen, setCrewAddOpen,
    crewAddLoading, setCrewAddLoading,
    crewAddSearchRef,
    // Handlers
    handleCrewAddSearch,
    handleCrewAddSelect,
    handleCrewRemove,
    resetCrewMissionState,
    isCrewEventForCurrentSession,
  };
}
