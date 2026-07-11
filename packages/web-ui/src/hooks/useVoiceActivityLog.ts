import { useEffect, useRef, useState } from 'react';
import type { TelemetryEvent } from '../api';
import { eventBelongsToViewSession } from '../chat/session-stream-filter';
import { chatAgentTelemetryToLogEntry, type OpsLogEntry } from '../telemetry/ops-log';
import { subscribeOptimizedTelemetry } from '../perf/optimized-telemetry';

const MAX_ENTRIES = 80;

/** Live agent/tool log for voice UI — subscribes directly to telemetry (not AppContext.events). */
export function useVoiceActivityLog(
  sessionId: string | null,
  turnEpoch: number,
  enabled: boolean,
) {
  const [entries, setEntries] = useState<OpsLogEntry[]>([]);
  const turnEpochRef = useRef(turnEpoch);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      turnEpochRef.current = 0;
      return;
    }
    if (turnEpochRef.current !== turnEpoch) {
      turnEpochRef.current = turnEpoch;
      setEntries([]);
    }
  }, [turnEpoch, enabled]);

  useEffect(() => {
    if (!enabled || !sessionId || turnEpoch === 0) return;

    const disconnect = subscribeOptimizedTelemetry((ev: TelemetryEvent) => {
      if (!eventBelongsToViewSession(ev, sessionIdRef.current)) return;
      const entry = chatAgentTelemetryToLogEntry(ev);
      if (!entry) return;
      setEntries((prev) => [...prev, entry].slice(-MAX_ENTRIES));
    });

    return disconnect;
  }, [enabled, sessionId, turnEpoch]);

  return entries;
}
