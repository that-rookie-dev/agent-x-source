import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { getSecretSauceDir, getLogger } from '@agentx/shared';

/**
 * One-shot migration: reads old JSON files and inserts data into the new DB tables.
 * After successful migration, files are renamed to *.json.migrated (backup, not delete).
 * Safe to call on every startup — skips if DB already has data or files don't exist.
 */
export function migrateSecretSauceToDb(db: any): number {
  if (!db) return 0;

  const sauceDir = getSecretSauceDir();
  let migrated = 0;

  // ─── SOUL.md → agent_soul ───
  const soulPath = join(sauceDir, 'SOUL.md');
  if (existsSync(soulPath)) {
    try {
      const existing = db.prepare('SELECT id FROM agent_soul WHERE id = 1').get();
      if (!existing) {
        const content = readFileSync(soulPath, 'utf-8');
        db.prepare('INSERT INTO agent_soul (id, content) VALUES (1, ?)').run(content);
        try { renameSync(soulPath, soulPath + '.migrated'); } catch { getLogger().debug('MIGRATE', 'soul rename skipped'); }
        migrated++;
      }
    } catch { /* non-critical */ }
  }

  // ─── global/memories.json → agent_memories ───
  const memPath = join(sauceDir, 'global', 'memories.json');
  if (existsSync(memPath)) {
    try {
      const existing = db.prepare('SELECT COUNT(*) as c FROM agent_memories').get() as { c: number };
      if (existing?.c === 0) {
        const memories = JSON.parse(readFileSync(memPath, 'utf-8')) as Array<{
          id?: string; content: string; category?: string; timestamp?: string; relevance?: number;
        }>;
        const insert = db.prepare(
          `INSERT OR IGNORE INTO agent_memories (id, category, content, relevance, created_at)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const m of memories) {
          insert.run(
            m.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            m.category || 'context',
            m.content,
            m.relevance ?? 1.0,
            m.timestamp || new Date().toISOString(),
          );
        }
        try { renameSync(memPath, memPath + '.migrated'); } catch { getLogger().debug('MIGRATE', 'soul rename skipped'); }
        migrated++;
      }
    } catch { /* non-critical */ }
  }

  // ─── crews/default/identity.json → agent_identity ───
  const idPath = join(sauceDir, 'crews', 'default', 'identity.json');
  if (existsSync(idPath)) {
    try {
      const existing = db.prepare('SELECT interaction_count as c FROM agent_identity WHERE id = 1').get() as { c: number } | undefined;
      if (!existing || existing.c === 0) {
        const id = JSON.parse(readFileSync(idPath, 'utf-8')) as {
          name?: string; personality?: string; traits?: string[];
          communicationStyle?: string; interactionCount?: number;
          evolutionLog?: Array<{ date: string; change: string; trigger: string }>;
        };
        db.prepare(`
          UPDATE agent_identity SET
            name = ?, personality = ?, traits = ?, communication_style = ?,
            interaction_count = ?, evolution_log = ?, updated_at = datetime('now')
          WHERE id = 1
        `).run(
          id.name || 'Agent X',
          id.personality || null,
          JSON.stringify(id.traits || []),
          id.communicationStyle || null,
          id.interactionCount || 0,
          JSON.stringify(id.evolutionLog || []),
        );
        try { renameSync(idPath, idPath + '.migrated'); } catch { getLogger().debug('MIGRATE', 'soul rename skipped'); }
        migrated++;
      }
    } catch { /* non-critical */ }
  }

  // ─── crews/default/diary.json → agent_diary ───
  const diaryPath = join(sauceDir, 'crews', 'default', 'diary.json');
  if (existsSync(diaryPath)) {
    try {
      const existing = db.prepare('SELECT COUNT(*) as c FROM agent_diary').get() as { c: number };
      if (existing?.c === 0) {
        const entries = JSON.parse(readFileSync(diaryPath, 'utf-8')) as Array<{
          date: string; summary: string; sessionsCount?: number;
          highlights?: string[]; insights?: string[];
        }>;
        const insert = db.prepare(
          `INSERT OR IGNORE INTO agent_diary (id, date, summary, sessions_count, highlights, insights)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const e of entries) {
          insert.run(
            `diary_${e.date}`,
            e.date,
            e.summary,
            e.sessionsCount || 1,
            JSON.stringify(e.highlights || []),
            JSON.stringify(e.insights || []),
          );
        }
        try { renameSync(diaryPath, diaryPath + '.migrated'); } catch { getLogger().debug('MIGRATE', 'soul rename skipped'); }
        migrated++;
      }
    } catch { /* non-critical */ }
  }

  // ─── summarization-state.json → agent_summarization_state ───
  const sumPath = join(sauceDir, 'summarization-state.json');
  if (existsSync(sumPath)) {
    try {
      const existing = db.prepare('SELECT id FROM agent_summarization_state WHERE id = 1').get();
      if (!existing) {
        const state = JSON.parse(readFileSync(sumPath, 'utf-8')) as {
          lastMemorySummarization?: string; lastDiarySummarization?: string;
          memorySummary?: string; diarySummary?: string;
        };
        db.prepare(`
          INSERT INTO agent_summarization_state (id, last_memory_summarization, last_diary_summarization, memory_summary, diary_summary)
          VALUES (1, ?, ?, ?, ?)
        `).run(
          state.lastMemorySummarization || null,
          state.lastDiarySummarization || null,
          state.memorySummary || null,
          state.diarySummary || null,
        );
        try { renameSync(sumPath, sumPath + '.migrated'); } catch { getLogger().debug('MIGRATE', 'soul rename skipped'); }
        migrated++;
      }
    } catch { /* non-critical */ }
  }

  return migrated;
}
