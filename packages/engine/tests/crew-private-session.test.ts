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
    expect(s1.mode).toBe('plan');

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
});
