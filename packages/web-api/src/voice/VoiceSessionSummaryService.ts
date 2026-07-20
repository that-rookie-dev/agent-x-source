import { getLogger } from '@agentx/shared';
import { ProviderFactory } from '@agentx/engine';
import { getEngine } from '../engine.js';
import { isCrewCallEventText } from '../voice-speakable.js';
import {
  REMIND_RECENT_MAX_MESSAGES,
  summaryNeedsDailyRebuild,
} from './voice-realtime-policy.js';
import {
  loadVoiceRealtimeState,
  saveVoiceRealtimeState,
} from './voice-realtime-store.js';

export interface VoiceHistoryMessage {
  id?: string;
  role?: string;
  content?: string;
  createdAt?: string;
}

async function completeWithDefaultLlm(prompt: string): Promise<string | null> {
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const providerId = cfg.provider.activeProvider;
    const providerCfg = cfg.provider.providers?.[providerId];
    if (!providerCfg?.configured || !providerCfg?.apiKey) {
      getLogger().warn('VOICE_SUMMARY', 'Default LLM not configured — skipping summary rebuild');
      return null;
    }
    const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
    const model = cfg.provider.activeModel || 'gpt-4o-mini';
    let text = '';
    for await (const chunk of provider.complete({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens: 700,
      stream: false,
    })) {
      if (chunk.type === 'text_delta' && chunk.content) text += chunk.content;
    }
    return text.trim() || null;
  } catch (err) {
    getLogger().warn(
      'VOICE_SUMMARY',
      `LLM summary failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function filterSpeakable(messages: VoiceHistoryMessage[]): VoiceHistoryMessage[] {
  return messages.filter((m) => {
    if (m.role !== 'user' && m.role !== 'assistant') return false;
    const text = (m.content ?? '').trim();
    if (!text) return false;
    if (isCrewCallEventText(text)) return false;
    return true;
  });
}

function messagesAfterWatermark(
  messages: VoiceHistoryMessage[],
  summaryUpdatedAt: string | null | undefined,
): VoiceHistoryMessage[] {
  if (!summaryUpdatedAt) return messages;
  const t = Date.parse(summaryUpdatedAt);
  if (!Number.isFinite(t)) return messages;
  return messages.filter((m) => {
    if (!m.createdAt) return true;
    const mt = Date.parse(m.createdAt);
    if (!Number.isFinite(mt)) return true;
    return mt > t;
  });
}

function formatTurns(messages: VoiceHistoryMessage[], limit?: number): string {
  const slice = limit != null ? messages.slice(-limit) : messages;
  return slice
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content ?? '').trim().slice(0, 600)}`)
    .join('\n');
}

function buildSummaryPrompt(existingSummary: string | null, delta: VoiceHistoryMessage[]): string {
  const prior = existingSummary?.trim()
    ? `Existing summary (keep true facts, drop noise, merge carefully):\n${existingSummary.trim()}\n\n`
    : 'No prior summary.\n\n';
  return `${prior}New conversation turns since the last summary update:
${formatTurns(delta)}

Write an updated voice-session continuity summary for a realtime voice agent.
Include ONLY:
- Key points and topics discussed
- Decisions made / preferences stated
- Standing facts the agent must remember
- Open threads (if any)

Rules:
- Plain text, bullet-style, max ~250 words
- No markdown fences, no roleplay, no greeting
- Do not invent facts not present in the inputs`;
}

/** Load speakable messages for a voice session (oldest → newest). */
export async function loadVoiceSessionMessages(sessionId: string): Promise<VoiceHistoryMessage[]> {
  try {
    const store = getEngine().sessionManager.getStorageAdapter();
    if (!store) return [];
    try { await store.ensureSessionHydrated?.(sessionId); } catch { /* best-effort */ }
    const msgs = store.getMessages?.(sessionId) ?? [];
    return filterSpeakable(
      msgs.map((m) => ({
        id: typeof m.id === 'string' ? m.id : undefined,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        createdAt: typeof m.createdAt === 'string' ? m.createdAt : undefined,
      })),
    );
  } catch {
    return [];
  }
}

/**
 * Ensure a rolling summary exists / is refreshed at most once per day when
 * there are unsummarised messages. Returns the current summary text (or null).
 */
export async function ensureVoiceSessionSummary(sessionId: string): Promise<string | null> {
  const state = await loadVoiceRealtimeState(sessionId);
  const all = await loadVoiceSessionMessages(sessionId);
  if (all.length === 0) return state?.summary?.trim() || null;

  const delta = messagesAfterWatermark(all, state?.summaryUpdatedAt);
  const needsRebuild = summaryNeedsDailyRebuild(state?.summaryUpdatedAt);
  const hasDelta = delta.length > 0;

  if (state?.summary?.trim() && (!needsRebuild || !hasDelta)) {
    return state.summary.trim();
  }

  if (!hasDelta && state?.summary?.trim()) {
    return state.summary.trim();
  }

  // First summary or daily rebuild with new turns.
  const prompt = buildSummaryPrompt(state?.summary ?? null, hasDelta ? delta : all.slice(-40));
  const summary = await completeWithDefaultLlm(prompt);
  if (!summary) {
    return state?.summary?.trim() || null;
  }

  const last = (hasDelta ? delta : all).at(-1);
  // Watermark = last included message time so later turns aren't skipped/double-counted.
  const watermark = last?.createdAt && Number.isFinite(Date.parse(last.createdAt))
    ? last.createdAt
    : new Date().toISOString();
  await saveVoiceRealtimeState(sessionId, {
    summary,
    summaryUpdatedAt: watermark,
    summarySourceMessageId: last?.id ?? null,
    preserveExistingConversationId: true,
  });
  getLogger().info(
    'VOICE_SUMMARY',
    `Updated summary for ${sessionId} (${hasDelta ? delta.length : all.length} turns)`,
  );
  return summary;
}

/** Recent unsummarised (or last-N) turns for the warm remind band. */
export async function loadRecentVoiceDelta(
  sessionId: string,
  summaryUpdatedAt: string | null | undefined,
  maxMessages: number = REMIND_RECENT_MAX_MESSAGES,
): Promise<VoiceHistoryMessage[]> {
  const all = await loadVoiceSessionMessages(sessionId);
  const after = messagesAfterWatermark(all, summaryUpdatedAt);
  const pool = after.length > 0 ? after : all;
  return pool.slice(-maxMessages);
}

export function buildWarmReminderText(
  summary: string | null,
  recent: VoiceHistoryMessage[],
  idleMinutes: number,
): string {
  const parts = [
    `[Voice session continuity — idle ~${Math.max(1, Math.round(idleMinutes))} minutes. xAI cache may have expired; use this context and continue naturally. Do not re-introduce yourself unless asked.]`,
  ];
  if (summary?.trim()) {
    parts.push(`Summary:\n${summary.trim()}`);
  }
  if (recent.length > 0) {
    parts.push(`Recent turns:\n${formatTurns(recent)}`);
  }
  return parts.join('\n\n');
}

export function buildColdSummaryText(summary: string): string {
  return `[Voice session continuity — long idle (>2h). Continue from this summary only; do not assume verbatim prior dialogue.\n\nSummary:\n${summary.trim()}]`;
}
