import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../src/session/SessionStore.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SessionStore', () => {
  let store: SessionStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentx-test-'));
    store = new SessionStore(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates and retrieves a session', () => {
    store.createSession({
      id: 'sess_1',
      title: 'Test Session',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const session = store.getSession('sess_1');
    expect(session).not.toBeNull();
    expect(session!['title']).toBe('Test Session');
    expect(session!['provider']).toBe('openai');
  });

  it('returns null for nonexistent session', () => {
    expect(store.getSession('nonexistent')).toBeNull();
  });

  it('updates session fields', () => {
    store.createSession({
      id: 'sess_2',
      title: 'Original',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    store.updateSession('sess_2', { title: 'Updated', status: 'completed' });
    const session = store.getSession('sess_2');
    expect(session!['title']).toBe('Updated');
    expect(session!['status']).toBe('completed');
  });

  it('lists sessions ordered by updatedAt desc', () => {
    store.createSession({
      id: 'sess_a',
      title: 'First',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    });
    store.createSession({
      id: 'sess_b',
      title: 'Second',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    });

    const list = store.listSessions();
    expect(list).toHaveLength(2);
    expect(list[0]!['id']).toBe('sess_b');
  });

  it('adds and retrieves messages', () => {
    store.createSession({
      id: 'sess_m',
      title: 'Msg Test',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    store.addMessage({
      id: 'msg_1',
      sessionId: 'sess_m',
      role: 'user',
      content: 'Hello',
      createdAt: new Date().toISOString(),
    });

    store.addMessage({
      id: 'msg_2',
      sessionId: 'sess_m',
      role: 'assistant',
      content: 'Hi there!',
      createdAt: new Date().toISOString(),
    });

    const msgs = store.getMessages('sess_m');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!['role']).toBe('user');
    expect(msgs[1]!['role']).toBe('assistant');
  });

  it('counts messages', () => {
    store.createSession({
      id: 'sess_c',
      title: 'Count',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(store.getMessageCount('sess_c')).toBe(0);
    store.addMessage({ id: 'msg_x', sessionId: 'sess_c', role: 'user', content: 'hi', createdAt: new Date().toISOString() });
    expect(store.getMessageCount('sess_c')).toBe(1);
  });

  it('deletes session and related data', () => {
    store.createSession({
      id: 'sess_d',
      title: 'Delete Me',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.addMessage({ id: 'msg_d', sessionId: 'sess_d', role: 'user', content: 'bye', createdAt: new Date().toISOString() });

    store.deleteSession('sess_d');
    expect(store.getSession('sess_d')).toBeNull();
    expect(store.getMessages('sess_d')).toHaveLength(0);
  });
});
