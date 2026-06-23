import { describe, it, expect } from 'vitest';
import { decomposeCrewTasks, resolveMissionProtocol } from '../src/agent/crew-task-decomposition.js';
import {
  beginMissionSession,
  endMissionSession,
  isMissionInProgress,
  registerMission,
  registerWorker,
  resolveCrewIdFromWorker,
  unregisterMission,
} from '../src/agent/crew-mission-registry.js';
import { CrewMissionContext } from '../src/agent/CrewMissionContext.js';
import { AgentEventBus } from '../src/EventBus.js';
import type { CrewMember } from '../src/agent/CrewOrchestrator.js';
import type { Crew } from '@agentx/shared';

function mockCrew(overrides: Partial<Crew> & Pick<Crew, 'id' | 'name' | 'callsign' | 'systemPrompt'>): Crew {
  return {
    isDefault: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockMember(crew: Crew): CrewMember {
  return {
    crew,
    expertise: crew.expertise ?? [],
    active: true,
    tokensUsedThisSession: 0,
    cpuTimeMs: 0,
  };
}

describe('crew-task-decomposition', () => {
  it('assigns per-mention task slices', () => {
    const dev = mockCrew({ id: 'dev', name: 'Dev', callsign: 'devops', systemPrompt: 'devops', expertise: ['devops'] });
    const design = mockCrew({ id: 'design', name: 'Design', callsign: 'designer', systemPrompt: 'design', expertise: ['design'] });
    const members = [mockMember(dev), mockMember(design)];

    const tasks = decomposeCrewTasks(
      '@devops fix the API and @designer refresh the dashboard UI',
      members,
    );

    expect(tasks.get('dev')!.toLowerCase()).toContain('fix');
    expect(tasks.get('design')!.toLowerCase()).toContain('dashboard');
  });

  it('uses sequential protocol when any crew requests handoff', () => {
    const a = mockCrew({ id: 'a', name: 'A', callsign: 'a', systemPrompt: 'a', protocol: 'handoff' });
    const b = mockCrew({ id: 'b', name: 'B', callsign: 'b', systemPrompt: 'b', protocol: 'parallel' });
    expect(resolveMissionProtocol([mockMember(a), mockMember(b)])).toBe('handoff');
  });

  it('uses debate protocol when any crew requests debate', () => {
    const a = mockCrew({ id: 'a', name: 'A', callsign: 'a', systemPrompt: 'a', protocol: 'debate' });
    const b = mockCrew({ id: 'b', name: 'B', callsign: 'b', systemPrompt: 'b', protocol: 'parallel' });
    expect(resolveMissionProtocol([mockMember(a), mockMember(b)])).toBe('debate');
  });
});

describe('crew-mission-registry', () => {
  it('guards concurrent missions per session', () => {
    const sessionId = 'session-test-1';
    expect(beginMissionSession(sessionId, 'm1')).toBe(true);
    expect(isMissionInProgress(sessionId)).toBe(true);
    expect(beginMissionSession(sessionId, 'm2')).toBe(false);
    endMissionSession(sessionId, 'm1');
    expect(isMissionInProgress(sessionId)).toBe(false);
  });

  it('resolves crew id from worker session id deterministically', () => {
    const crewId = 'df827878-5024-4c9d-87b4-d24e8c97985b';
    const workerId = `crew-worker-${crewId}-a1b2c3d4`;
    const missionId = 'mission-1';
    const sessionId = 'session-crew-1';
    const crew = mockCrew({ id: crewId, name: 'Raj', callsign: 'raj_patel', systemPrompt: 'tax' });
    const member = mockMember(crew);
    const context = new CrewMissionContext(missionId, 'analyze tax file');
    const eventBus = new AgentEventBus();

    beginMissionSession(sessionId, missionId);
    registerMission({
      missionId,
      sessionId,
      context,
      members: [member],
      eventBus,
    });
    registerWorker(workerId, missionId);

    expect(resolveCrewIdFromWorker(workerId)).toBe(crewId);

    unregisterMission(missionId);
    endMissionSession(sessionId, missionId);
  });

  it('bumps context revision when artifacts or messages are added', () => {
    const context = new CrewMissionContext('m-rev', 'test');
    expect(context.contextRevision).toBe(0);
    context.addArtifact({
      workerId: 'w1',
      crewId: 'c1',
      crewName: 'A',
      callsign: 'a',
      type: 'output',
      content: 'hello',
    });
    expect(context.contextRevision).toBe(1);
    context.addInterMessage('A', 'B', 'ping');
    expect(context.contextRevision).toBe(2);
  });
});
