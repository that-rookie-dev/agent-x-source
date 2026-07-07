import { useEffect, useRef, useState } from 'react';
import type { TelemetryEvent } from '../api';
import { eventBelongsToViewSession } from '../chat/session-stream-filter';
import { chatAgentTelemetryToLogEntry, type OpsLogEntry } from '../telemetry/ops-log';
import { useApp } from '../store/AppContext';

const MAX_ENTRIES = 80;

export function useVoiceActivityLog(
  sessionId: string | null,
  turnEpoch: number,
  enabled: boolean,
) {
  const { events } = useApp();
  const [entries, setEntries] = useState<OpsLogEntry[]>([]);
  const processedCountRef = useRef(0);
  const turnEpochRef = useRef(turnEpoch);

  const resetLog = (cursor = events.length) => {
    setEntries([]);
    processedCountRef.current = cursor;
  };

  useEffect(() => {
    if (!enabled) {
      resetLog(0);
      turnEpochRef.current = 0;
      return;
    }
    if (turnEpochRef.current !== turnEpoch) {
      turnEpochRef.current = turnEpoch;
      resetLog(events.length);
    }
  }, [turnEpoch, enabled, events.length]);

  useEffect(() => {
    if (!enabled || !sessionId || turnEpoch === 0) return;
    if (events.length <= processedCountRef.current) return;

    const fresh = events.slice(processedCountRef.current);
    processedCountRef.current = events.length;

    const next: OpsLogEntry[] = [];
    for (const ev of fresh as TelemetryEvent[]) {
      if (!eventBelongsToViewSession(ev, sessionId)) continue;
      const entry = chatAgentTelemetryToLogEntry(ev);
      if (entry) next.push(entry);
    }
    if (next.length === 0) return;
    setEntries((prev) => [...prev, ...next].slice(-MAX_ENTRIES));
  }, [events, sessionId, turnEpoch, enabled]);

  return entries;
}
