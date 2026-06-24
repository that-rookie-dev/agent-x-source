import { describe, it, expect } from 'vitest';
import { SessionManager } from '../src/session/SessionManager.js';

describe('SessionManager crew private sessions', () => {
  it('finds and creates one session per crew', () => {
    const mgr = new SessionManager();
    const crewA = { id: 'crew-a', name: 'Elias', callsign: 'elias_travel' };
    const crewB = { id: 'crew-b', name: 'Maya', callsign: 'maya_ops' };

    expect(mgr.findCrewPrivateSession('crew-a')).toBeNull();

    const s1 = mgr.createCrewPrivateSession('openai', 'gpt-4o', process.cwd(), crewA);
    expect(s1.contextKind).toBe('crew_private');
    expect(s1.hostCrewId).toBe('crew-a');

    const s2 = mgr.createCrewPrivateSession('openai', 'gpt-4o', process.cwd(), crewA);
    expect(s2.id).toBe(s1.id);

    const s3 = mgr.createCrewPrivateSession('openai', 'gpt-4o', process.cwd(), crewB);
    expect(s3.id).not.toBe(s1.id);
    expect(mgr.findCrewPrivateSession('crew-b')?.id).toBe(s3.id);
  });

  it('getSessionById returns crew private without switching active session', () => {
    const mgr = new SessionManager();
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

  it('consolidates duplicate crew private sessions for the same crew', () => {
    const mgr = new SessionManager();
    const crew = { id: 'crew-dup', name: 'Dup', callsign: 'dup_x' };
    const s1 = mgr.createCrewPrivateSession('openai', 'gpt-4o', process.cwd(), crew);
    const store = (mgr as unknown as {
      store: {
        insertMessage: (m: Record<string, unknown>) => string;
        createSession: (s: Record<string, unknown>) => void;
      };
    }).store;
    store.insertMessage({ sessionId: s1.id, role: 'user', content: 'hello' });

    const now = new Date().toISOString();
    store.createSession({
      id: 'duplicate-crew-private',
      title: 'Dup',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      scopePath: process.cwd(),
      contextKind: 'crew_private',
      hostCrewId: crew.id,
      createdAt: now,
      updatedAt: now,
    });

    const canonical = mgr.resolveCanonicalCrewPrivateSession(crew.id);
    expect(canonical?.id).toBe(s1.id);
    expect(mgr.findAllCrewPrivateSessions(crew.id)).toHaveLength(1);
  });
});
