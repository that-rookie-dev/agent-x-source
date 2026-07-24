import {
  isCallDividerContent,
  isCrewVoiceSessionId,
  seedCallDividerClock,
} from '@agentx/shared';
import { getEngine } from '../engine.js';
import { isCrewCallEventText } from '../voice-speakable.js';

/** Align write-time divider clock with the last spoken turn already in DB. */
export function seedCallDividerClockFromStore(sessionId: string): void {
  if (!isCrewVoiceSessionId(sessionId)) return;
  try {
    const store = getEngine().sessionManager.getStorageAdapter();
    const msgs = store?.getMessages?.(sessionId) ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = String(m.content ?? '').trim();
      if (!text || isCrewCallEventText(text) || isCallDividerContent(text)) continue;
      const at = Date.parse(String(m.createdAt ?? ''));
      seedCallDividerClock(sessionId, Number.isFinite(at) ? at : null);
      return;
    }
    seedCallDividerClock(sessionId, null);
  } catch {
    /* best-effort */
  }
}
