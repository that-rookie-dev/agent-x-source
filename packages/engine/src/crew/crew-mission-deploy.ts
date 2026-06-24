import type { Crew, CrewCreateInput } from '@agentx/shared';
import type { CrewManager } from '../secret-sauce/CrewManager.js';
import type { Agent } from '../agent/Agent.js';
import type { CrewMatchCandidate } from '@agentx/shared';
import { getCrewSuggestionService } from './get-crew-store.js';

export async function recruitCandidatesForMission(
  crewManager: CrewManager,
  agent: Agent | null,
  candidates: CrewMatchCandidate[],
  catalogStore: { getCatalogEntry: (id: string) => Promise<{ id: string; callsign: string; name: string; title: string; description: string; systemPrompt: string; tone?: string; expertise: string[]; traits: string[] } | null> },
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

      const existing = crewManager.list().find(
        (c) => c.catalogId === catalog.id || c.callsign === catalog.callsign,
      );
      if (existing) {
        crewManager.enable(existing.id);
        if (agent) {
          agent.addCrewMember(existing);
          agent.setCrewEnabled(existing.id, true);
        }
        deployedIds.push(existing.id);
        continue;
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
        enabled: true,
      };
      const crew = crewManager.create(input);
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
