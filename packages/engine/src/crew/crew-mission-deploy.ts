import type { Crew, CrewCreateInput } from '@agentx/shared';
import { hubCatalogIdFromCallsign } from '@agentx/shared';
import type { CrewManager } from '../crew/CrewManager.js';
import type { Agent } from '../agent/Agent.js';
import type { CrewMatchCandidate } from '@agentx/shared';
import type { CrewMember } from '../agent/CrewOrchestrator.js';
import { parseCrewMentionKeys } from '../agent/crew-mission-helpers.js';
import { getCrewSuggestionService } from './get-crew-store.js';

export type CrewCatalogRecruitStore = {
  getCatalogEntry: (id: string) => Promise<{
    id: string;
    callsign: string;
    name: string;
    title: string;
    description: string;
    systemPrompt: string;
    tone?: string;
    expertise: string[];
    traits: string[];
    tools?: string[];
  } | null>;
};

function callsignsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function findRosterCrewForHubReference(crewManager: CrewManager, crew: Crew): Crew | undefined {
  const byId = crewManager.get(crew.id);
  if (byId) return byId;

  if (crew.catalogId) {
    const byCatalog = crewManager.list().find((c) => c.catalogId === crew.catalogId);
    if (byCatalog) return byCatalog;
  }

  return crewManager.list().find((c) => callsignsMatch(c.callsign, crew.callsign));
}

function createHubCrewFromCatalogEntry(
  crewManager: CrewManager,
  catalog: NonNullable<Awaited<ReturnType<CrewCatalogRecruitStore['getCatalogEntry']>>>,
): Crew | null {
  const existing = crewManager.list().find(
    (c) => c.catalogId === catalog.id || callsignsMatch(c.callsign, catalog.callsign),
  );
  if (existing) return existing;

  // Respect intentional deactivation — do not silently re-recruit from leftover refs.
  if (crewManager.isIntentionallyDeleted(catalog.id, catalog.id)) {
    return null;
  }

  const input: CrewCreateInput = {
    id: catalog.id,
    name: catalog.name,
    title: catalog.title,
    callsign: catalog.callsign,
    systemPrompt: catalog.systemPrompt,
    description: catalog.description,
    emotion: catalog.tone as Crew['emotion'],
    source: 'hub',
    catalogId: catalog.id,
    expertise: catalog.expertise,
    traits: catalog.traits,
    tools: catalog.tools,
    enabled: true,
  };

  try {
    return crewManager.create(input);
  } catch {
    const fallback = crewManager.list().find(
      (c) => c.catalogId === catalog.id || callsignsMatch(c.callsign, catalog.callsign),
    );
    if (fallback) return fallback;
    throw new Error(`Failed to recruit hub crew ${catalog.id}`);
  }
}

/** Ensure a hub crew referenced in mission context exists on the global roster. */
export async function ensureHubCrewOnRoster(
  crewManager: CrewManager,
  crew: Crew,
  catalogStore: CrewCatalogRecruitStore | null,
): Promise<Crew> {
  const existing = findRosterCrewForHubReference(crewManager, crew);
  if (existing) return existing;

  const catalogId = crew.catalogId ?? (crew.id.startsWith('hub-') ? crew.id : undefined);
  if (!catalogId || !catalogStore) return crew;

  if (crewManager.isIntentionallyDeleted(crew.id, catalogId)) {
    return crew;
  }

  const catalog = await catalogStore.getCatalogEntry(catalogId);
  if (!catalog) return crew;

  return createHubCrewFromCatalogEntry(crewManager, catalog) ?? crew;
}

/** Recruit mission crew to roster and wire them into the active agent (Agent-X sessions only). */
export async function ensureCrewMembersOnRoster(
  crewManager: CrewManager,
  members: CrewMember[],
  catalogStore: CrewCatalogRecruitStore | null,
  agent: Agent | null,
): Promise<CrewMember[]> {
  const resolved: CrewMember[] = [];

  for (const member of members) {
    const crew = await ensureHubCrewOnRoster(crewManager, member.crew, catalogStore);
    if (!crewManager.get(crew.id)) continue;
    crewManager.enable(crew.id);
    if (agent) {
      agent.addCrewMember(crew);
      agent.setCrewEnabled(crew.id, true);
    }
    resolved.push({ ...member, crew });
  }

  return resolved;
}

function matchCrewByMentionKey(crew: Crew, key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return false;
  return crew.callsign.toLowerCase() === k
    || crew.id.toLowerCase() === k
    || (crew.catalogId?.toLowerCase() === k)
    || crew.name.toLowerCase() === k
    || crew.name.toLowerCase().replace(/\s+/g, '_') === k
    || hubCatalogIdFromCallsign(crew.callsign).toLowerCase() === k;
}

/**
 * Resolve @crew mentions for group-chat routing: session roster → global roster → Hub catalog.
 * Recruits missing hub specialists onto the session so explicit mentions never silently no-op.
 */
export async function resolveMentionedCrewMembers(
  crewManager: CrewManager,
  agent: Agent,
  catalogStore: CrewCatalogRecruitStore | null,
  content: string,
): Promise<{ members: CrewMember[]; unresolved: string[] }> {
  const keys = parseCrewMentionKeys(content);
  if (keys.length === 0) return { members: [], unresolved: [] };

  const members: CrewMember[] = [];
  const unresolved: string[] = [];
  const seenIds = new Set<string>();

  for (const key of keys) {
    let crew: Crew | undefined =
      agent.getCrewMembers().find((m) => matchCrewByMentionKey(m.crew, key))?.crew
      ?? crewManager.list().find((c) => matchCrewByMentionKey(c, key));

    if (!crew && catalogStore) {
      const catalogIds = [
        key.startsWith('hub-') ? key : hubCatalogIdFromCallsign(key),
        key,
      ];
      for (const catalogId of catalogIds) {
        const catalog = await catalogStore.getCatalogEntry(catalogId);
        if (!catalog) continue;
        const recruited = createHubCrewFromCatalogEntry(crewManager, catalog);
        if (recruited) {
          crew = recruited;
          break;
        }
      }
    }

    if (!crew) {
      unresolved.push(key);
      continue;
    }

    crew = await ensureHubCrewOnRoster(crewManager, crew, catalogStore);
    // Must be on the global roster — skip ephemeral / intentionally deleted refs.
    if (!crewManager.get(crew.id) || crew.enabled === false) {
      unresolved.push(key);
      continue;
    }

    crewManager.enable(crew.id);
    agent.addCrewMember(crew);
    agent.setCrewEnabled(crew.id, true);

    const wired = agent.getCrewMembers().find((m) => m.crew.id === crew!.id);
    const member: CrewMember = {
      crew: wired?.crew ?? crew,
      expertise: wired?.expertise ?? crew.expertise ?? [],
      active: true,
      tokensUsedThisSession: 0,
      cpuTimeMs: 0,
    };

    if (!seenIds.has(member.crew.id)) {
      seenIds.add(member.crew.id);
      members.push(member);
    }
  }

  return { members, unresolved };
}

export async function recruitCandidatesForMission(
  crewManager: CrewManager,
  agent: Agent | null,
  candidates: CrewMatchCandidate[],
  catalogStore: CrewCatalogRecruitStore,
): Promise<string[]> {
  const deployedIds: string[] = [];

  for (const candidate of candidates) {
    if (candidate.onRoster) {
      crewManager.enable(candidate.id);
      if (agent) {
        const existing = crewManager.get(candidate.id);
        if (existing) {
          agent.addCrewMember(existing);
          agent.setCrewEnabled(candidate.id, true);
        }
      }
      deployedIds.push(candidate.id);
      continue;
    }

    if (candidate.origin === 'hub_catalog' && candidate.catalogId) {
      const catalog = await catalogStore.getCatalogEntry(candidate.catalogId);
      if (!catalog) continue;

      const crew = createHubCrewFromCatalogEntry(crewManager, catalog);
      if (!crew) continue;
      crewManager.enable(crew.id);
      if (agent) {
        agent.addCrewMember(crew);
        agent.setCrewEnabled(crew.id, true);
      }
      deployedIds.push(crew.id);
    }
  }

  return deployedIds;
}

export { getCrewSuggestionService };
