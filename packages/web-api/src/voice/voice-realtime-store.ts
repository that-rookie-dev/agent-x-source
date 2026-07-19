import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentFilesDir, getLogger } from '@agentx/shared';
import type { VoiceRealtimeState, VoiceRealtimeStatePatch } from '@agentx/shared';
import { getEngine } from '../engine.js';

function filePath(sessionId: string): string {
  const dir = join(getAgentFilesDir(), 'voice-realtime');
  mkdirSync(dir, { recursive: true });
  const safe = sessionId.replace(/[^a-zA-Z0-9:._-]/g, '_');
  return join(dir, `${safe}.json`);
}

function readFileState(sessionId: string): VoiceRealtimeState | null {
  try {
    const path = filePath(sessionId);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as VoiceRealtimeState;
    if (!raw || raw.sessionId !== sessionId) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeFileState(state: VoiceRealtimeState): void {
  try {
    writeFileSync(filePath(state.sessionId), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    getLogger().warn(
      'VOICE_REALTIME',
      `Failed to persist file state: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function mergeFileState(sessionId: string, patch: VoiceRealtimeStatePatch): VoiceRealtimeState {
  const now = new Date().toISOString();
  const prev = readFileState(sessionId);
  const preserveId = patch.preserveExistingConversationId !== false;
  let nextConversationId = patch.xaiConversationId !== undefined
    ? patch.xaiConversationId
    : (prev?.xaiConversationId ?? null);
  if (preserveId && prev?.xaiConversationId) {
    nextConversationId = prev.xaiConversationId;
  }
  const next: VoiceRealtimeState = {
    sessionId,
    xaiConversationId: nextConversationId,
    xaiConversationUpdatedAt: patch.xaiConversationUpdatedAt !== undefined
      ? patch.xaiConversationUpdatedAt
      : (prev?.xaiConversationUpdatedAt ?? null),
    lastVoiceActiveAt: patch.lastVoiceActiveAt !== undefined
      ? patch.lastVoiceActiveAt
      : (prev?.lastVoiceActiveAt ?? null),
    summary: patch.summary !== undefined ? patch.summary : (prev?.summary ?? null),
    summaryUpdatedAt: patch.summaryUpdatedAt !== undefined
      ? patch.summaryUpdatedAt
      : (prev?.summaryUpdatedAt ?? null),
    summarySourceMessageId: patch.summarySourceMessageId !== undefined
      ? patch.summarySourceMessageId
      : (prev?.summarySourceMessageId ?? null),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  if (!prev?.xaiConversationId && next.xaiConversationId && !next.xaiConversationUpdatedAt) {
    next.xaiConversationUpdatedAt = now;
  }
  writeFileState(next);
  return next;
}

function store() {
  try {
    return getEngine().sessionManager.getStorageAdapter();
  } catch {
    return null;
  }
}

/** Promote file-backed state into Postgres once so loads don't diverge. */
async function migrateFileToPostgres(
  sessionId: string,
  fileState: VoiceRealtimeState,
): Promise<VoiceRealtimeState | null> {
  const s = store();
  if (!s?.upsertVoiceRealtimeState) return null;
  try {
    return await s.upsertVoiceRealtimeState(sessionId, {
      xaiConversationId: fileState.xaiConversationId,
      xaiConversationUpdatedAt: fileState.xaiConversationUpdatedAt,
      lastVoiceActiveAt: fileState.lastVoiceActiveAt,
      summary: fileState.summary,
      summaryUpdatedAt: fileState.summaryUpdatedAt,
      summarySourceMessageId: fileState.summarySourceMessageId,
      preserveExistingConversationId: true,
    });
  } catch (err) {
    getLogger().warn(
      'VOICE_REALTIME',
      `File→PG migrate failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function loadVoiceRealtimeState(sessionId: string): Promise<VoiceRealtimeState | null> {
  const s = store();
  if (s?.getVoiceRealtimeState) {
    try {
      const row = await s.getVoiceRealtimeState(sessionId);
      if (row) {
        // Keep file mirror in sync for crash recovery without PG.
        writeFileState(row);
        return row;
      }
    } catch (err) {
      getLogger().warn(
        'VOICE_REALTIME',
        `PG get failed, trying file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const fileState = readFileState(sessionId);
  if (!fileState) return null;

  const migrated = await migrateFileToPostgres(sessionId, fileState);
  return migrated ?? fileState;
}

export async function saveVoiceRealtimeState(
  sessionId: string,
  patch: VoiceRealtimeStatePatch,
): Promise<VoiceRealtimeState> {
  // Ensure PG cache/DB is hydrated before partial patches.
  await loadVoiceRealtimeState(sessionId);

  const s = store();
  if (s?.upsertVoiceRealtimeState) {
    try {
      const row = await s.upsertVoiceRealtimeState(sessionId, patch);
      writeFileState(row);
      return row;
    } catch (err) {
      getLogger().warn(
        'VOICE_REALTIME',
        `PG upsert failed, falling back to file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return mergeFileState(sessionId, patch);
}

export async function touchVoiceRealtimeActive(sessionId: string, at?: string): Promise<void> {
  const when = at ?? new Date().toISOString();
  await saveVoiceRealtimeState(sessionId, {
    lastVoiceActiveAt: when,
    preserveExistingConversationId: true,
  });
}

/** Persist xAI conversation id once — never rotate an existing id. */
export async function persistXaiConversationId(
  sessionId: string,
  conversationId: string,
): Promise<VoiceRealtimeState | null> {
  const trimmed = conversationId.trim();
  if (!trimmed) return loadVoiceRealtimeState(sessionId);
  return saveVoiceRealtimeState(sessionId, {
    xaiConversationId: trimmed,
    xaiConversationUpdatedAt: new Date().toISOString(),
    preserveExistingConversationId: true,
  });
}
