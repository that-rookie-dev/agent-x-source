import { describe, it, expect, vi } from 'vitest';
import type { Crew, CrewCreateInput } from '@agentx/shared';
import type { CrewManager } from '../src/crew/CrewManager.js';
import type { CrewMember } from '../src/agent/CrewOrchestrator.js';
import {
  ensureHubCrewOnRoster,
  ensureCrewMembersOnRoster,
  recruitCandidatesForMission,
  resolveMentionedCrewMembers,
} from '../src/crew/crew-mission-deploy.js';
import { parseCrewMentionKeys } from '../src/agent/crew-mission-helpers.js';

function mockCrew(overrides: Partial<Crew> & Pick<Crew, 'id' | 'name' | 'callsign' | 'systemPrompt'>): Crew {
  return {
    isDefault: false,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockCrewManager(initial: Crew[] = []): CrewManager {
  const crews = new Map(initial.map((c) => [c.id, { ...c }]));
  return {
    get: (id: string) => crews.get(id),
    list: () => [...crews.values()],
    create: (input: CrewCreateInput) => {
      const crew = mockCrew({
        id: input.id ?? `crew-${crews.size}`,
        name: input.name,
        callsign: input.callsign,
        systemPrompt: input.systemPrompt,
        title: input.title,
        catalogId: input.catalogId,
        source: input.source,
      });
      crews.set(crew.id, crew);
      return crew;
    },
    enable: vi.fn((id: string) => {
      const crew = crews.get(id);
      if (crew) crew.enabled = true;
    }),
  } as unknown as CrewManager;
}

describe('crew-mission-deploy roster recruit', () => {
  const catalog = {
    id: 'hub-nova_ops',
    callsign: 'nova_ops',
    name: 'Nova',
    title: 'Operations Lead',
    description: 'Ops specialist',
    systemPrompt: 'You are Nova.',
    tone: 'focused',
    expertise: ['operations'],
    traits: ['decisive'],
    tools: ['read_file'],
  };

  const catalogStore = {
    getCatalogEntry: vi.fn(async (id: string) => (id === catalog.id ? catalog : null)),
  };

  it('recruits hub crew to roster when missing', async () => {
    const crewManager = createMockCrewManager();
    const ephemeral = mockCrew({
      id: 'hub-nova_ops',
      name: 'Nova',
      callsign: 'nova_ops',
      systemPrompt: 'You are Nova.',
      catalogId: 'hub-nova_ops',
      source: 'hub',
    });

    const recruited = await ensureHubCrewOnRoster(crewManager, ephemeral, catalogStore);
    expect(recruited.id).toBe('hub-nova_ops');
    expect(crewManager.list()).toHaveLength(1);
    expect(catalogStore.getCatalogEntry).toHaveBeenCalledWith('hub-nova_ops');
  });

  it('skips recruit when crew already on roster', async () => {
    const existing = mockCrew({
      id: 'roster-1',
      name: 'Nova',
      callsign: 'nova_ops',
      systemPrompt: 'You are Nova.',
      catalogId: 'hub-nova_ops',
      source: 'hub',
    });
    const crewManager = createMockCrewManager([existing]);
    const createSpy = vi.spyOn(crewManager, 'create');

    const recruited = await ensureHubCrewOnRoster(
      crewManager,
      mockCrew({
        id: 'hub-nova_ops',
        name: 'Nova',
        callsign: 'nova_ops',
        systemPrompt: 'You are Nova.',
        catalogId: 'hub-nova_ops',
        source: 'hub',
      }),
      catalogStore,
    );

    expect(recruited.id).toBe('roster-1');
    expect(createSpy).not.toHaveBeenCalled();
    expect(crewManager.list()).toHaveLength(1);
  });

  it('ensureCrewMembersOnRoster enables and wires each member', async () => {
    const crewManager = createMockCrewManager();
    const agent = {
      addCrewMember: vi.fn(),
      setCrewEnabled: vi.fn(),
    };
    const member: CrewMember = {
      crew: mockCrew({
        id: 'hub-nova_ops',
        name: 'Nova',
        callsign: 'nova_ops',
        systemPrompt: 'You are Nova.',
        catalogId: 'hub-nova_ops',
        source: 'hub',
      }),
      expertise: ['operations'],
      active: true,
      tokensUsedThisSession: 0,
      cpuTimeMs: 0,
    };

    const resolved = await ensureCrewMembersOnRoster(crewManager, [member], catalogStore, agent as never);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.crew.id).toBe('hub-nova_ops');
    expect(agent.addCrewMember).toHaveBeenCalledTimes(1);
    expect(agent.setCrewEnabled).toHaveBeenCalledWith('hub-nova_ops', true);
    expect(crewManager.enable).toHaveBeenCalledWith('hub-nova_ops');
  });

  it('recruitCandidatesForMission deploys hub catalog candidates', async () => {
    const crewManager = createMockCrewManager();
    const deployed = await recruitCandidatesForMission(
      crewManager,
      null,
      [{
        id: 'hub-nova_ops',
        origin: 'hub_catalog',
        catalogId: 'hub-nova_ops',
        callsign: 'nova_ops',
        name: 'Nova',
        title: 'Operations Lead',
        description: 'Ops specialist',
        expertise: ['operations'],
        traits: ['decisive'],
        onRoster: false,
        matchScore: 1,
        reasons: [],
      }],
      catalogStore,
    );

    expect(deployed).toEqual(['hub-nova_ops']);
    expect(crewManager.list()).toHaveLength(1);
  });

  it('parseCrewMentionKeys reads composer @crew chips', () => {
    expect(parseCrewMentionKeys(
      'Hi @crew[efe_popov_0lmv8l:Efe%20Popov], analyse @file[tax.pdf]?',
    )).toEqual(['efe_popov_0lmv8l']);
  });

  it('resolveMentionedCrewMembers recruits Hub catalog specialists not on session roster', async () => {
    const crewManager = createMockCrewManager();
    const sessionMembers: Array<{ crew: Crew; expertise: string[]; active: boolean }> = [];
    const agent = {
      getCrewMembers: () => sessionMembers,
      addCrewMember: vi.fn((crew: Crew) => {
        sessionMembers.push({ crew, expertise: crew.expertise ?? [], active: true });
      }),
      setCrewEnabled: vi.fn(),
    };

    const { members, unresolved } = await resolveMentionedCrewMembers(
      crewManager,
      agent as never,
      catalogStore,
      'Hi @crew[nova_ops:Nova], please help',
    );

    expect(unresolved).toEqual([]);
    expect(members).toHaveLength(1);
    expect(members[0]!.crew.callsign).toBe('nova_ops');
    expect(agent.addCrewMember).toHaveBeenCalled();
    expect(agent.setCrewEnabled).toHaveBeenCalledWith('hub-nova_ops', true);
  });

  it('resolveMentionedCrewMembers reports unresolved unknown callsigns', async () => {
    const crewManager = createMockCrewManager();
    const agent = {
      getCrewMembers: () => [],
      addCrewMember: vi.fn(),
      setCrewEnabled: vi.fn(),
    };

    const { members, unresolved } = await resolveMentionedCrewMembers(
      crewManager,
      agent as never,
      catalogStore,
      '@crew[missing_specialist:Missing]',
    );

    expect(members).toEqual([]);
    expect(unresolved).toEqual(['missing_specialist']);
  });
});
