import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Crew, CrewEmotion, CrewCreateInput, CollaborationProtocol, CrewResourceQuota, PermissionRule } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getSecretSauceDir } from '../config/paths.js';
import type { SessionStore } from '../session/SessionStore.js';

export class CrewManager {
  private crews: Crew[] = [];
  private secretSauceDir: string;
  private store: SessionStore | null = null;

  constructor(store?: SessionStore) {
    this.secretSauceDir = getSecretSauceDir();
    this.store = store ?? null;
    this.loadCrews();
  }

  setStore(store: SessionStore): void {
    this.store = store;
    this.loadCrews();
  }

  refresh(): void {
    this.loadCrews();
  }

  private loadCrews(): void {
    if (this.store) {
      try {
        const dbCrews = this.store.listCrews();
        if (dbCrews.length > 0) {
          this.crews = dbCrews;
          return;
        }
      } catch (e) {
        getLogger().warn('CREW_MGR', `DB load failed, falling back to file: ${e instanceof Error ? e.message : e}`);
      }
    }
    const crewPath = join(this.secretSauceDir, 'crews.json');
    if (existsSync(crewPath)) {
      try {
        const raw = readFileSync(crewPath, 'utf-8');
        const data = raw.startsWith('{') ? raw : raw;
        const parsed = JSON.parse(data) as { crews: Array<Record<string, unknown>> };
        this.crews = parsed.crews.map((p) => ({
          id: p['id'] as string,
          name: p['name'] as string,
          title: (p['title'] as string | undefined),
          callsign: (p['callsign'] as string) ?? (p['id'] as string),
          systemPrompt: (p['systemPrompt'] as string) ?? '',
          emotion: (p['emotion'] as CrewEmotion | undefined) ?? (p['tone'] as CrewEmotion | undefined),
          isDefault: (p['isDefault'] as boolean) ?? false,
          enabled: (p['enabled'] as boolean) ?? true,
          expertise: (p['expertise'] as string[] | undefined),
          traits: (p['traits'] as string[] | undefined),
          toolPreferences: (p['toolPreferences'] as { enabled?: string[]; disabled?: string[] } | undefined),
          tools: (p['tools'] as string[] | undefined),
          permissions: (p['permissions'] as PermissionRule[] | undefined),
          model: (p['model'] as { provider: string; modelId: string } | undefined),
          color: (p['color'] as string | undefined),
          icon: (p['icon'] as string | undefined),
          protocol: (p['protocol'] as CollaborationProtocol | undefined),
          quotas: (p['quotas'] as CrewResourceQuota | undefined),
          createdAt: (p['createdAt'] as string) ?? new Date().toISOString(),
          updatedAt: (p['updatedAt'] as string) ?? new Date().toISOString(),
        }));
        if (this.store && this.crews.length > 0) {
          for (const crew of this.crews) {
            if (typeof this.store.getCrew === 'function' && this.store.getCrew(crew.id)) {
              if (typeof this.store.updateCrew === 'function') {
                this.store.updateCrew(crew.id, crew);
              }
            } else if (typeof this.store.createCrew === 'function') {
              this.store.createCrew(this.crewToCreateInput(crew));
            }
          }
        }
      } catch {
        this.crews = [];
      }
    } else {
      this.crews = [];
    }
  }

  private crewToCreateInput(crew: Crew): CrewCreateInput {
    return {
      id: crew.id,
      name: crew.name,
      title: crew.title,
      callsign: crew.callsign,
      systemPrompt: crew.systemPrompt,
      description: crew.description,
      emotion: crew.emotion,
      source: crew.source,
      catalogId: crew.catalogId,
      searchText: crew.searchText,
      suggestable: crew.suggestable,
      isDefault: crew.isDefault,
      enabled: crew.enabled,
      expertise: crew.expertise,
      traits: crew.traits,
      toolPreferences: crew.toolPreferences,
      tools: crew.tools,
      permissions: crew.permissions,
      model: crew.model,
      protocol: crew.protocol,
      quotas: crew.quotas,
      color: crew.color,
      icon: crew.icon,
    };
  }

  private persist(): void {
    if (this.store) {
      for (const crew of this.crews) {
        const input = this.crewToCreateInput(crew);
        if (typeof this.store.getCrew === 'function' && this.store.getCrew(crew.id)) {
          if (typeof this.store.updateCrew === 'function') {
            this.store.updateCrew(crew.id, crew);
          }
        } else if (typeof this.store.createCrew === 'function') {
          this.store.createCrew(input);
        }
      }
    }
  }

  list(): Crew[] {
    return [...this.crews];
  }

  listEnabled(): Crew[] {
    return this.crews.filter((c) => c.enabled);
  }

  get(id: string): Crew | undefined {
    return this.crews.find((p) => p.id === id);
  }

  enable(id: string): boolean {
    const crew = this.crews.find((p) => p.id === id);
    if (!crew) return false;
    crew.enabled = true;
    crew.updatedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  disable(id: string): boolean {
    const crew = this.crews.find((p) => p.id === id);
    if (!crew) return false;
    crew.enabled = false;
    crew.updatedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  create(input: CrewCreateInput): Crew {
    const callsign = (input.callsign || input.name).replace(/\s+/g, '').toLowerCase();
    if (!/^\S+$/.test(callsign)) {
      throw new Error('Callsign must not contain spaces');
    }
    if (this.crews.some((c) => c.callsign.toLowerCase() === callsign)) {
      throw new Error(`Callsign "${callsign}" is already taken`);
    }
    const crew: Crew = {
      id: input.id,
      name: input.name,
      title: input.title,
      callsign,
      systemPrompt: input.systemPrompt,
      description: input.description,
      emotion: input.emotion,
      source: input.source ?? (input.catalogId ? 'hub' : 'custom'),
      catalogId: input.catalogId,
      searchText: input.searchText,
      suggestable: input.suggestable ?? true,
      isDefault: input.isDefault ?? false,
      enabled: input.enabled ?? true,
      expertise: input.expertise,
      traits: input.traits,
      toolPreferences: input.toolPreferences,
      tools: input.tools,
      permissions: input.permissions,
      model: input.model,
      protocol: input.protocol,
      quotas: input.quotas,
      color: input.color,
      icon: input.icon,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.crews.push(crew);
    this.persist();
    return crew;
  }

  delete(id: string): boolean {
    const idx = this.crews.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.crews.splice(idx, 1);
    if (this.store && typeof this.store.deleteCrew === 'function') {
      this.store.deleteCrew(id);
    }
    return true;
  }

  update(id: string, updates: { name?: string; title?: string; callsign?: string; systemPrompt?: string; description?: string; emotion?: CrewEmotion; expertise?: string[]; traits?: string[]; toolPreferences?: { enabled?: string[]; disabled?: string[] }; protocol?: CollaborationProtocol; quotas?: CrewResourceQuota; color?: string; icon?: string }): Crew | null {
    const idx = this.crews.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const crew = this.crews[idx]!;
    if (updates.name !== undefined) crew.name = updates.name;
    if (updates.title !== undefined) crew.title = updates.title;
    if (updates.callsign !== undefined) {
      const cs = updates.callsign.replace(/\s+/g, '').toLowerCase();
      if (!/^\S+$/.test(cs)) throw new Error('Callsign must not contain spaces');
      if (this.crews.some((c) => c.callsign === cs && c.id !== id)) throw new Error(`Callsign "${cs}" is already taken`);
      crew.callsign = cs;
    }
    if (updates.systemPrompt !== undefined) crew.systemPrompt = updates.systemPrompt;
    if (updates.description !== undefined) crew.description = updates.description;
    if (updates.emotion !== undefined) crew.emotion = updates.emotion;
    if (updates.expertise !== undefined) crew.expertise = updates.expertise;
    if (updates.traits !== undefined) crew.traits = updates.traits;
    if (updates.toolPreferences !== undefined) crew.toolPreferences = updates.toolPreferences;
    if (updates.protocol !== undefined) crew.protocol = updates.protocol;
    if (updates.quotas !== undefined) crew.quotas = updates.quotas;
    if (updates.color !== undefined) crew.color = updates.color;
    if (updates.icon !== undefined) crew.icon = updates.icon;
    crew.updatedAt = new Date().toISOString();
    this.crews[idx] = crew;
    if (this.store && typeof this.store.updateCrew === 'function') {
      this.store.updateCrew(id, crew);
    }
    return crew;
  }

  getMultiCrewSystemPrompt(): string {
    const enabledCrews = this.listEnabled();
    if (enabledCrews.length === 0) return '';

    const crewDescriptions = enabledCrews.map((c) => {
      const expertise = c.expertise?.join(', ') || 'general';
      const description = c.title ? `${c.name} — ${c.title}` : c.name;
      return `- **${description}** (@${c.callsign}): ${expertise}`;
    }).join('\n');

    return `The following crew members are available in this session:\n\n${crewDescriptions}\n\n**Group Chat Rules:**\n- Users can @mention a specific crew member to get their expertise directly\n- If no crew is @mentioned, Agent-X is the primary assistant and answers first\n- Agent-X may delegate to crew only when a task clearly requires specialist expertise\n- Crew members respond with their unique personalities and knowledge\n- Maintain context across the conversation - all participants see the full history`;
  }
}
