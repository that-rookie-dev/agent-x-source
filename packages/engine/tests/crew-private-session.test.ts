import { describe, it, expect } from 'vitest';
import { SessionManager } from '../src/session/SessionManager.js';
import type { StorageAdapter, StorableSession } from '@agentx/shared';

function createMockStorageAdapter(): StorageAdapter {
  const sessions = new Map<string, StorableSession>();
  return {
    connect: () => {},
    disconnect: () => {},
    isConnected: () => true,
    createSession: (input: Omit<StorableSession, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
      const session = { id: input.id ?? crypto.randomUUID(), ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as StorableSession;
      sessions.set(session.id, session);
      return session;
    },
    getSession: (id: string) => sessions.get(id) ?? null,
    updateSession: (id: string, updates: Partial<StorableSession>) => {
      const s = sessions.get(id);
      if (s) Object.assign(s, updates);
    },
    deleteSession: (id: string) => { sessions.delete(id); },
    listSessions: (limit?: number) => Array.from(sessions.values()).slice(0, limit),
    addMessage: () => ({ id: 'm1', sessionId: 's1', role: 'user', content: '', createdAt: new Date().toISOString() } as any),
    getMessages: () => [],
    deleteMessages: () => {},
    getMessageCount: () => 0,
    addTokenLog: () => {},
    getTokenLogs: () => [],
    listCrews: () => [],
    getCrew: () => undefined,
    getDefaultCrew: () => undefined,
    createCrew: (input: any) => ({ id: 'c1', ...input }),
    updateCrew: () => null,
    deleteCrew: () => {},
    clearAll: () => sessions.clear(),
    close: () => sessions.clear(),
  };
}

describe('SessionManager crew private sessions', () => {
  it('finds and creates one session per crew', () => {
    const mgr = new SessionManager({ storageAdapter: createMockStorageAdapter() });
    const crewA = { id: 'crew-a', name: 'Elias', callsign: 'elias_travel' };
    const crewB = { id: 'crew-b', name: 'Maya', callsign: 'maya_ops' };

    expect(mgr.findCrewPrivateSession('crew-a')).toBeNull();

    const s1 = mgr.createCrewPrivateSession('openai', 'gpt-4o', process.cwd(), crewA);
    expect(s1.contextKind).toBe('crew_private');
    expect(s1.hostCrewId).toBe('crew-a');
    expect(s1.bypassPermissions).toBe(false);

    const s2 = mgr.createCrewPrivateSession('openai', 'gpt-4o', process.cwd(), crewA);
    expect(s2.id).toBe(s1.id);

    const s3 = mgr.createCrewPrivateSession('openai', 'gpt-4o', process.cwd(), crewB);
    expect(s3.id).not.toBe(s1.id);
    expect(mgr.findCrewPrivateSession('crew-b')?.id).toBe(s3.id);
  });

  it('getSessionById returns crew private without switching active session', () => {
    const mgr = new SessionManager({ storageAdapter: createMockStorageAdapter() });
    const active = mgr.createSession('openai', 'gpt-4o', process.cwd());
    const crewPrivate = mgr.createCrewPrivateSession('openai', 'gpt-4o', process.cwd(), {
      id: 'crew-x',
      name: 'Nova',
      callsign: 'nova',
    });

    const peek = mgr.getSessionById(crewPrivate.id);
    expect(peek?.contextKind).toBe('crew_private');
    expect(peek?.hostCrewId).toBe('crew-x');
    expect(mgr.getActiveSession()?.id).toBe(active.id);
  });
});
