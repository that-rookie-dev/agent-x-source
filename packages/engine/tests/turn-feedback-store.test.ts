import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../src/session/SessionStore.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SessionStore turn feedback', () => {
  let store: SessionStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-tf-'));
    store = new SessionStore(join(tempDir, 'test.db'));
    store.createSession({
      id: 'sess_tf',
      title: 'Feedback test',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('upserts and reads turn feedback per session', () => {
    store.upsertTurnFeedback({
      id: 'fb1',
      sessionId: 'sess_tf',
      messageId: 'msg1',
      contextKind: 'agent_x',
      rating: 'positive',
      turnSummary: 'Helpful plan',
      createdAt: new Date().toISOString(),
    });

    let rows = store.getTurnFeedbackBySession('sess_tf');
    expect(rows).toHaveLength(1);
    expect(rows[0]!['rating']).toBe('positive');

    store.upsertTurnFeedback({
      id: 'fb2',
      sessionId: 'sess_tf',
      messageId: 'msg1',
      contextKind: 'agent_x',
      rating: 'negative',
      turnSummary: 'Changed mind',
      createdAt: new Date().toISOString(),
    });

    rows = store.getTurnFeedbackBySession('sess_tf');
    expect(rows).toHaveLength(1);
    expect(rows[0]!['rating']).toBe('negative');
  });
});
