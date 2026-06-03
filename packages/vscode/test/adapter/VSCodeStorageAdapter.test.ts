import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VSCodeStorageAdapter } from '../../src/adapter/VSCodeStorageAdapter';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('VSCodeStorageAdapter', () => {
  let tmpDir: string;
  let adapter: VSCodeStorageAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentx-test-'));
    adapter = new VSCodeStorageAdapter(tmpDir);
    adapter.connect();
  });

  afterEach(() => {
    adapter.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('connects and creates storage directory', () => {
    expect(adapter.isConnected()).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'agentx-data'))).toBe(true);
  });

  it('creates and retrieves sessions', () => {
    const session = adapter.createSession({
      title: 'Test Session',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    expect(session.id).toBeTruthy();
    expect(session.title).toBe('Test Session');
    expect(session.createdAt).toBeTruthy();

    const retrieved = adapter.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Test Session');
  });

  it('updates sessions', () => {
    const session = adapter.createSession({
      title: 'Original',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.updateSession(session.id, { title: 'Updated', tokenUsed: 500 });

    const updated = adapter.getSession(session.id);
    expect(updated!.title).toBe('Updated');
    expect(updated!.tokenUsed).toBe(500);
    expect(updated!.id).toBe(session.id);
  });

  it('deletes sessions and cascades to messages', () => {
    const session = adapter.createSession({
      title: 'ToDelete',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.addMessage(session.id, {
      role: 'user',
      content: 'Hello',
      tokenCount: 5,
    });

    adapter.deleteSession(session.id);

    expect(adapter.getSession(session.id)).toBeNull();
    expect(adapter.getMessages(session.id)).toHaveLength(0);
  });

  it('lists sessions sorted by updatedAt descending', async () => {
    adapter.createSession({
      title: 'First',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    await new Promise(r => setTimeout(r, 10));

    adapter.createSession({
      title: 'Second',
      status: 'active',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 200000,
    });

    const sessions = adapter.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].title).toBe('Second');
  });

  it('adds and retrieves messages', () => {
    const session = adapter.createSession({
      title: 'MsgTest',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.addMessage(session.id, {
      role: 'user',
      content: 'Hello',
      tokenCount: 5,
    });

    adapter.addMessage(session.id, {
      role: 'assistant',
      content: 'Hi there!',
      tokenCount: 10,
    });

    const messages = adapter.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(adapter.getMessageCount(session.id)).toBe(2);
  });

  it('adds and retrieves token logs', () => {
    const session = adapter.createSession({
      title: 'TokenTest',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.addTokenLog(session.id, {
      inputTokens: 100,
      outputTokens: 50,
      model: 'gpt-4o',
    });

    const logs = adapter.getTokenLogs(session.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].inputTokens).toBe(100);
  });

  it('adds and retrieves permissions', () => {
    const session = adapter.createSession({
      title: 'PermTest',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.addPermission(session.id, {
      toolName: 'shell_exec',
      targetPath: '/tmp',
      decision: 'allow_once',
    });

    const perms = adapter.getPermissions(session.id);
    expect(perms).toHaveLength(1);
    expect(perms[0].toolName).toBe('shell_exec');
  });

  it('clearAll resets all data', () => {
    adapter.createSession({
      title: 'ClearTest',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.clearAll();

    expect(adapter.listSessions()).toHaveLength(0);
  });

  it('handles corrupted JSON gracefully', () => {
    const sessionsPath = path.join(tmpDir, 'agentx-data', 'sessions.json');
    fs.writeFileSync(sessionsPath, 'NOT VALID JSON', 'utf-8');

    expect(adapter.listSessions()).toHaveLength(0);
  });
});
