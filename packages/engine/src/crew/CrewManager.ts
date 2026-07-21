import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Crew, CrewEmotion, CrewCreateInput, CollaborationProtocol, CrewResourceQuota, PermissionRule, StorageAdapter } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getDataDir } from '../config/paths.js';

/** Minimal host snapshot from a crew_private session — used to restore orphaned roster rows. */
export interface CrewHostSnapshot {
  id: string;
  name: string;
  callsign: string;
  title?: string | null;
  color?: string | null;
  catalogId?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  expertise?: string[] | null;
  traits?: string[] | null;
  source?: Crew['source'] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface CrewTombstoneFile {
  ids: string[];
  catalogIds: string[];
}

export class CrewManager {
  private crews: Crew[] = [];
  private store: StorageAdapter | null = null;
  /** Intentionally deleted roster ids / hub catalog ids — never auto-resurrect these. */
  private deletedIds = new Set<string>();
  private deletedCatalogIds = new Set<string>();

  constructor(store?: StorageAdapter) {
    this.store = store ?? null;
    this.loadTombstones();
    this.loadCrews();
  }

  setStore(store: StorageAdapter): void {
    this.store = store;
    this.loadTombstones();
    this.loadCrews();
  }

  refresh(): void {
    this.loadTombstones();
    this.loadCrews();
  }

  private crewsFilePath(): string {
    return join(getDataDir(), 'crews.json');
  }

  private tombstoneFilePath(): string {
    return join(getDataDir(), 'crew-deleted.json');
  }

  private legacyCrewsFilePath(): string {
    return join(getDataDir(), 'secret-sauce', 'crews.json');
  }

  private loadTombstones(): void {
    this.deletedIds = new Set();
    this.deletedCatalogIds = new Set();
    const path = this.tombstoneFilePath();
    if (!existsSync(path)) return;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CrewTombstoneFile>;
      for (const id of raw.ids ?? []) {
        if (typeof id === 'string' && id.trim()) this.deletedIds.add(id.trim());
      }
      for (const id of raw.catalogIds ?? []) {
        if (typeof id === 'string' && id.trim()) this.deletedCatalogIds.add(id.trim());
      }
    } catch {
      /* ignore corrupt tombstone file */
    }
  }

  private writeTombstones(): void {
    try {
      mkdirSync(getDataDir(), { recursive: true });
      const payload: CrewTombstoneFile = {
        ids: [...this.deletedIds].sort(),
        catalogIds: [...this.deletedCatalogIds].sort(),
      };
      writeFileSync(this.tombstoneFilePath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e) {
      getLogger().warn('CREW_MGR', `Failed to write crew-deleted.json: ${e instanceof Error ? e.message : e}`);
    }
  }

  private isTombstoned(id: string, catalogId?: string | null): boolean {
    if (this.deletedIds.has(id)) return true;
    const cat = catalogId?.trim();
    return Boolean(cat && this.deletedCatalogIds.has(cat));
  }

  /** True when the user explicitly deleted this roster / hub catalog entry. */
  isIntentionallyDeleted(id: string, catalogId?: string | null): boolean {
    return this.isTombstoned(id, catalogId);
  }

  private markDeleted(id: string, catalogId?: string | null): void {
    this.deletedIds.add(id);
    const cat = catalogId?.trim();
    if (cat) this.deletedCatalogIds.add(cat);
    this.writeTombstones();
  }

  private clearTombstone(id: string, catalogId?: string | null): void {
    let changed = this.deletedIds.delete(id);
    const cat = catalogId?.trim();
    if (cat && this.deletedCatalogIds.delete(cat)) changed = true;
    if (changed) this.writeTombstones();
  }

  /** Hub crews are re-recruitable from catalog; session-host recovery is only for custom/user crews. */
  private isHubHost(host: CrewHostSnapshot): boolean {
    if (host.source === 'hub') return true;
    if (host.catalogId?.trim()) return true;
    return false;
  }

  private resolveCrewsFilePath(): string {
    const primary = this.crewsFilePath();
    if (existsSync(primary)) return primary;
    const legacy = this.legacyCrewsFilePath();
    if (existsSync(legacy)) return legacy;
    return primary;
  }

  private loadCrewsFromFile(): Crew[] {
    const crewPath = this.resolveCrewsFilePath();
    if (!existsSync(crewPath)) return [];
    try {
      const raw = readFileSync(crewPath, 'utf-8');
      const parsed = JSON.parse(raw) as { crews: Array<Record<string, unknown>> };
      return (parsed.crews ?? []).map((p) => this.rowToCrew(p));
    } catch {
      return [];
    }
  }

  private rowToCrew(p: Record<string, unknown>): Crew {
    return {
      id: p['id'] as string,
      name: p['name'] as string,
      title: (p['title'] as string | undefined),
      callsign: (p['callsign'] as string) ?? (p['id'] as string),
      systemPrompt: (p['systemPrompt'] as string) ?? '',
      description: (p['description'] as string | undefined),
      emotion: (p['emotion'] as CrewEmotion | undefined) ?? (p['tone'] as CrewEmotion | undefined),
      source: (p['source'] as Crew['source'] | undefined),
      catalogId: (p['catalogId'] as string | undefined),
      searchText: (p['searchText'] as string | undefined),
      suggestable: (p['suggestable'] as boolean | undefined),
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
    };
  }

  /**
   * Sync file backup of the roster. Always written on mutate so a crash before
   * the Postgres write-queue drains cannot erase user-created crews.
   */
  private writeFileBackup(): void {
    try {
      mkdirSync(getDataDir(), { recursive: true });
      writeFileSync(
        this.crewsFilePath(),
        JSON.stringify({ crews: this.crews }, null, 2),
        'utf-8',
      );
    } catch (e) {
      getLogger().warn('CREW_MGR', `Failed to write crews.json backup: ${e instanceof Error ? e.message : e}`);
    }
  }

  private loadCrews(): void {
    let dbCrews: Crew[] = [];
    if (this.store) {
      try {
        dbCrews = this.store.listCrews();
      } catch (e) {
        getLogger().warn('CREW_MGR', `DB load failed, falling back to file: ${e instanceof Error ? e.message : e}`);
      }
    }

    const fileCrews = this.loadCrewsFromFile();
    const byId = new Map<string, Crew>();
    // Prefer DB rows, then fill gaps from the local backup (crash / deferred-store recovery).
    for (const crew of fileCrews) {
      if (crew?.id) byId.set(crew.id, crew);
    }
    for (const crew of dbCrews) {
      if (crew?.id) byId.set(crew.id, crew);
    }
    this.crews = [...byId.values()];

    // Drop intentionally deleted crews that may still linger in the local backup / DB lag.
    const beforeTombstone = this.crews.length;
    if (this.deletedIds.size > 0 || this.deletedCatalogIds.size > 0) {
      this.crews = this.crews.filter((c) => !this.isTombstoned(c.id, c.catalogId));
    }
    const purgedTombstones = beforeTombstone !== this.crews.length;

    // Re-upsert any file-only crews into the DB so they survive subsequent restarts.
    // Never resurrect tombstoned (intentionally deleted) rows.
    if (this.store && fileCrews.length > 0) {
      const dbIds = new Set(dbCrews.map((c) => c.id));
      for (const crew of fileCrews) {
        if (!crew?.id || dbIds.has(crew.id)) continue;
        if (this.isTombstoned(crew.id, crew.catalogId)) continue;
        try {
          if (typeof this.store.getCrew === 'function' && this.store.getCrew(crew.id)) {
            this.store.updateCrew?.(crew.id, crew);
          } else {
            this.store.createCrew?.(this.crewToCreateInput(crew));
          }
          getLogger().info('CREW_MGR', `Restored roster crew ${crew.id} (@${crew.callsign}) from local backup into DB`);
        } catch (e) {
          getLogger().warn('CREW_MGR', `Failed to restore crew ${crew.id} into DB: ${e instanceof Error ? e.message : e}`);
        }
      }
      void this.store.flushWrites?.().catch((e: unknown) => {
        getLogger().warn('CREW_MGR', `flushWrites after backup restore failed: ${e instanceof Error ? e.message : e}`);
      });
    }

    // Keep backup aligned with the merged roster (including empty after tombstone purge).
    if (this.crews.length > 0 || purgedTombstones) this.writeFileBackup();
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

  private persistCrew(crew: Crew): void {
    if (this.store) {
      try {
        if (typeof this.store.getCrew === 'function' && this.store.getCrew(crew.id)) {
          this.store.updateCrew?.(crew.id, crew);
        } else {
          this.store.createCrew?.(this.crewToCreateInput(crew));
        }
      } catch (e) {
        getLogger().error('CREW_MGR', `DB persist failed for ${crew.id}: ${e instanceof Error ? e.message : e}`);
        // File backup still written below — do not lose the roster row.
      }
    } else {
      getLogger().warn('CREW_MGR', `No storage adapter — crew ${crew.id} saved to local backup only until DB is ready`);
    }
    this.writeFileBackup();
  }

  /** Awaitable flush after mutations (API routes should call this). */
  async flushPersist(): Promise<void> {
    if (this.store?.flushWrites) {
      await this.store.flushWrites();
    }
  }

  /**
   * Rebuild missing roster entries from crew_private session host snapshots.
   * Intended as a crash safeguard for **custom / user-created** crews when the
   * async PG write queue never drained. Hub crews must NOT be resurrected here —
   * private-session leftovers would otherwise put deleted hub recruits back on
   * the roster; they can be recruited again from the catalog.
   */
  recoverFromSessionHosts(hosts: CrewHostSnapshot[]): number {
    let restored = 0;
    for (const host of hosts) {
      const id = host.id?.trim();
      if (!id || this.get(id)) continue;
      if (this.isHubHost(host)) {
        getLogger().info(
          'CREW_MGR',
          `Skipping session-host recovery for hub crew ${id}`
            + (host.catalogId ? ` (catalog ${host.catalogId})` : '')
            + ' — recruit from hub instead',
        );
        continue;
      }
      if (this.isTombstoned(id, host.catalogId)) {
        getLogger().info('CREW_MGR', `Skipping session-host recovery for deleted crew ${id}`);
        continue;
      }
      const callsign = (host.callsign || id).replace(/\s+/g, '').toLowerCase();
      if (this.crews.some((c) => c.callsign.toLowerCase() === callsign)) continue;
      const now = new Date().toISOString();
      const crew: Crew = {
        id,
        name: host.name?.trim() || callsign,
        title: host.title ?? undefined,
        callsign,
        systemPrompt: host.systemPrompt?.trim() || `You are ${host.name || callsign}.`,
        description: host.description ?? undefined,
        source: host.source ?? (host.catalogId ? 'hub' : 'custom'),
        catalogId: host.catalogId ?? undefined,
        color: host.color ?? undefined,
        expertise: host.expertise ?? undefined,
        traits: host.traits ?? undefined,
        isDefault: false,
        enabled: true,
        createdAt: host.createdAt || now,
        updatedAt: host.updatedAt || now,
      };
      this.crews.push(crew);
      this.persistCrew(crew);
      restored += 1;
      getLogger().info('CREW_MGR', `Recovered missing crew ${crew.id} (@${crew.callsign}) from session host snapshot`);
    }
    if (restored > 0) {
      void this.flushPersist().catch((e) => {
        getLogger().warn('CREW_MGR', `flush after session recovery failed: ${e instanceof Error ? e.message : e}`);
      });
    }
    return restored;
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
    this.persistCrew(crew);
    return true;
  }

  disable(id: string): boolean {
    const crew = this.crews.find((p) => p.id === id);
    if (!crew) return false;
    crew.enabled = false;
    crew.updatedAt = new Date().toISOString();
    this.persistCrew(crew);
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
    const source = input.source ?? (input.catalogId ? 'hub' : 'custom');
    // Re-recruit / recreate after an intentional delete is allowed.
    this.clearTombstone(input.id, input.catalogId);
    const crew: Crew = {
      id: input.id,
      name: input.name,
      title: input.title,
      callsign,
      systemPrompt: input.systemPrompt,
      description: input.description,
      emotion: input.emotion,
      source,
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
    this.persistCrew(crew);
    return crew;
  }

  delete(id: string): boolean {
    const idx = this.crews.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    const [removed] = this.crews.splice(idx, 1);
    if (this.store && typeof this.store.deleteCrew === 'function') {
      try {
        this.store.deleteCrew(id);
      } catch (e) {
        getLogger().error('CREW_MGR', `DB delete failed for ${id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    this.markDeleted(id, removed?.catalogId);
    this.writeFileBackup();
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
    this.persistCrew(crew);
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
