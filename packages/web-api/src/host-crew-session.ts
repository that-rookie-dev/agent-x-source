import type { CatalogEntry, Crew, CrewCreateInput, CrewEmotion, Session } from '@agentx/shared';
import { formatHostCrewIdentity, getLogger } from '@agentx/shared';
import { getCrewCatalogStoreFromEngine, hostCrewSnapshotPatch } from '@agentx/engine';

function crewCallsignsMatch(a: string, b: string): boolean {
  const norm = (c: string) => c.trim().toLowerCase().replace(/^dr_/, '');
  return norm(a) === norm(b);
}

function callsignFromHostCrewId(hostCrewId?: string | null): string | null {
  if (!hostCrewId?.startsWith('hub-')) return null;
  const callsign = hostCrewId.slice(4);
  return callsign || null;
}

type CrewHonorificHints = {
  categoryId?: string | null;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
};

type CrewWithHubMeta = Crew & CrewHonorificHints;

function hostCrewIdentityFromSessionAndCrew(
  session: Session,
  crew?: CrewWithHubMeta,
): {
  id: string;
  name: string;
  callsign: string;
  title?: string;
  color?: string;
  catalogId?: string;
  categoryId?: string | null;
  expertise?: string[];
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
} {
  return {
    id: crew?.id ?? session.hostCrewId ?? '',
    name: crew?.name ?? session.hostCrewName ?? session.title ?? '',
    callsign: crew?.callsign
      ?? session.hostCrewCallsign
      ?? callsignFromHostCrewId(session.hostCrewId)
      ?? '',
    title: crew?.title ?? session.hostCrewTitle ?? undefined,
    color: crew?.color ?? session.hostCrewColor ?? undefined,
    catalogId: crew?.catalogId ?? session.hostCrewCatalogId ?? undefined,
    categoryId: crew?.categoryId ?? session.hostCrewCategoryId ?? null,
    expertise: crew?.expertise,
    requiresMedicalDisclaimer: crew?.requiresMedicalDisclaimer,
    honorsDoctorate: crew?.honorsDoctorate,
  };
}

export function crewWithHonorificIdentity(
  crew: Crew,
  hints?: CrewHonorificHints,
): Crew {
  const formatted = formatHostCrewIdentity({
    name: crew.name,
    callsign: crew.callsign,
    title: crew.title,
    categoryId: hints?.categoryId ?? (crew as CrewWithHubMeta).categoryId,
    expertise: crew.expertise,
    requiresMedicalDisclaimer: hints?.requiresMedicalDisclaimer ?? (crew as CrewWithHubMeta).requiresMedicalDisclaimer,
    honorsDoctorate: hints?.honorsDoctorate ?? (crew as CrewWithHubMeta).honorsDoctorate,
  });
  if (formatted.name === crew.name && formatted.callsign === crew.callsign) return crew;

  let systemPrompt = crew.systemPrompt;
  if (crew.name !== formatted.name && systemPrompt.includes(crew.name)) {
    const esc = crew.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    systemPrompt = systemPrompt.replace(new RegExp(`You are ${esc}`, 'g'), `You are ${formatted.name}`);
  }

  return { ...crew, name: formatted.name, callsign: formatted.callsign, systemPrompt };
}

/** Persist Dr. honorific upgrades for legacy private-chat session snapshots. */
export function syncHostCrewHonorificToSession(
  session: Session,
  crew: Crew,
): Partial<Session> | null {
  const source = hostCrewIdentityFromSessionAndCrew(session, crew as CrewWithHubMeta);
  if (!source.id || !source.name || !source.callsign) return null;
  const patch = hostCrewSnapshotPatch(session, source);
  return Object.keys(patch).length > 0 ? patch as Partial<Session> : null;
}

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : raw.split(',').map((s) => s.trim()).filter(Boolean);
  } catch {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function catalogFromSqliteRow(row: Record<string, unknown>): CatalogEntry {
  return {
    id: row['id'] as string,
    callsign: row['callsign'] as string,
    name: row['name'] as string,
    title: (row['title'] as string) || '',
    categoryId: row['category_id'] as string,
    categoryLabel: (row['category_label'] as string) || '',
    description: (row['description'] as string) || '',
    systemPrompt: (row['system_prompt'] as string) || '',
    tone: (row['tone'] as string) || undefined,
    expertise: parseJsonArray(row['expertise']),
    traits: parseJsonArray(row['traits']),
    tools: parseJsonArray(row['tools']),
    searchText: (row['search_text'] as string) || '',
    hubRevision: (row['hub_revision'] as number) ?? 1,
    active: !!(row['active'] ?? 1),
    requiresMedicalDisclaimer: !!(row['requires_medical_disclaimer'] ?? row['requiresMedicalDisclaimer']),
    honorsDoctorate: !!(row['honors_doctorate'] ?? row['honorsDoctorate']),
  };
}

export interface ResolvedHostCrewDisplay {
  hostCrewId: string | null;
  hostCrewName: string | null;
  hostCrewCallsign: string | null;
  hostCrewTitle: string | null;
  hostCrewColor: string | null;
  hostCrewCatalogId: string | null;
  hostCrewCategoryId: string | null;
}

export function resolveHostCrewDisplay(
  session: Record<string, unknown>,
  rosterCrew?: CrewWithHubMeta,
): ResolvedHostCrewDisplay {
  const hostCrewId = (session['hostCrewId'] as string | null | undefined) ?? null;
  const fallbackCallsign = callsignFromHostCrewId(hostCrewId);

  const rawName = rosterCrew?.name
    ?? (session['hostCrewName'] as string | null | undefined)
    ?? (session['title'] as string | null | undefined)
    ?? null;
  const rawCallsign = rosterCrew?.callsign
    ?? (session['hostCrewCallsign'] as string | null | undefined)
    ?? fallbackCallsign
    ?? null;
  const hostCrewTitle = rosterCrew?.title
    ?? (session['hostCrewTitle'] as string | null | undefined)
    ?? null;
  const hostCrewColor = rosterCrew?.color
    ?? (session['hostCrewColor'] as string | null | undefined)
    ?? null;
  const hostCrewCatalogId = rosterCrew?.catalogId
    ?? (session['hostCrewCatalogId'] as string | null | undefined)
    ?? (hostCrewId?.startsWith('hub-') ? hostCrewId : null);
  const hostCrewCategoryId = rosterCrew?.categoryId
    ?? (session['hostCrewCategoryId'] as string | null | undefined)
    ?? null;

  let hostCrewName = rawName;
  let hostCrewCallsign = rawCallsign;
  if (rawName && rawCallsign) {
    const formatted = formatHostCrewIdentity({
      name: rawName,
      callsign: rawCallsign,
      title: hostCrewTitle,
      categoryId: hostCrewCategoryId,
      expertise: rosterCrew?.expertise,
      requiresMedicalDisclaimer: rosterCrew?.requiresMedicalDisclaimer,
      honorsDoctorate: rosterCrew?.honorsDoctorate,
    });
    hostCrewName = formatted.name;
    hostCrewCallsign = formatted.callsign;
  }

  return {
    hostCrewId,
    hostCrewName,
    hostCrewCallsign,
    hostCrewTitle,
    hostCrewColor,
    hostCrewCatalogId,
    hostCrewCategoryId,
  };
}

type CrewManagerLike = {
  get(id: string): Crew | undefined;
  list(): Crew[];
  create(input: CrewCreateInput): Crew;
};

function catalogIdForSession(session: Session): string | undefined {
  return session.hostCrewCatalogId
    ?? (session.hostCrewId?.startsWith('hub-') ? session.hostCrewId : undefined)
    ?? undefined;
}

function getCatalogEntrySync(store: unknown, catalogId: string): CatalogEntry | null {
  const db = (store as { getDb?: () => unknown })?.getDb?.();
  if (!db || typeof db !== 'object') return null;
  const prepare = (db as { prepare?: (sql: string) => { get: (...args: unknown[]) => Record<string, unknown> | undefined } }).prepare;
  if (!prepare) return null;
  try {
    const row = prepare.call(db, 'SELECT * FROM crew_catalog WHERE id = ?').get(catalogId);
    return row ? catalogFromSqliteRow(row) : null;
  } catch {
    return null;
  }
}

function catalogEntryToCrewHints(entry: CatalogEntry): CrewHonorificHints {
  return {
    categoryId: entry.categoryId,
    requiresMedicalDisclaimer: entry.requiresMedicalDisclaimer,
    honorsDoctorate: entry.honorsDoctorate,
  };
}

function finalizePrivateHostCrew(session: Session, crew: Crew, hints?: CrewHonorificHints): Crew {
  return crewWithHonorificIdentity(crew, {
    categoryId: hints?.categoryId ?? session.hostCrewCategoryId,
    requiresMedicalDisclaimer: hints?.requiresMedicalDisclaimer,
    honorsDoctorate: hints?.honorsDoctorate,
  });
}

function ephemeralCrewFromCatalogEntry(entry: CatalogEntry): Crew {
  const now = new Date().toISOString();
  return {
    id: entry.id,
    name: entry.name,
    title: entry.title,
    callsign: entry.callsign,
    systemPrompt: entry.systemPrompt,
    description: entry.description,
    emotion: entry.tone as CrewEmotion | undefined,
    expertise: entry.expertise,
    traits: entry.traits,
    tools: entry.tools,
    source: 'hub',
    catalogId: entry.id,
    isDefault: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function recruitCrewFromCatalogEntry(crewManager: CrewManagerLike, entry: CatalogEntry): Crew {
  const existing = crewManager.list().find((c) =>
    c.id === entry.id || crewCallsignsMatch(c.callsign, entry.callsign));
  if (existing) {
    return crewWithHonorificIdentity(existing, catalogEntryToCrewHints(entry));
  }

  const created = crewManager.create({
    id: entry.id,
    name: entry.name,
    title: entry.title,
    callsign: entry.callsign,
    systemPrompt: entry.systemPrompt,
    description: entry.description,
    emotion: entry.tone as CrewEmotion | undefined,
    expertise: entry.expertise,
    traits: entry.traits,
    tools: entry.tools,
    source: 'hub',
    catalogId: entry.id,
  });
  return crewWithHonorificIdentity(created, catalogEntryToCrewHints(entry));
}

export function crewFromSessionSnapshot(session: Session): Crew | undefined {
  const id = session.hostCrewId;
  const source = hostCrewIdentityFromSessionAndCrew(session);
  if (!id || !source.name || !source.callsign) return undefined;

  const formatted = formatHostCrewIdentity(source);
  const title = session.hostCrewTitle ?? undefined;
  const now = new Date().toISOString();
  return {
    id,
    name: formatted.name,
    title,
    callsign: formatted.callsign,
    systemPrompt: title
      ? `You are ${formatted.name}, ${title}. Respond in this private 1:1 chat as this specialist.`
      : `You are ${formatted.name}. Respond in this private 1:1 chat as this specialist.`,
    catalogId: session.hostCrewCatalogId ?? (id.startsWith('hub-') ? id : undefined),
    color: session.hostCrewColor ?? undefined,
    source: id.startsWith('hub-') ? 'hub' : 'custom',
    isDefault: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Sync resolve for createAgent — roster, sqlite catalog snapshot, then session fields (no roster recruit). */
export function resolveCrewPrivateHostForAgent(
  crewManager: CrewManagerLike,
  session: Session,
  store?: unknown,
): Crew | undefined {
  if ((session.contextKind ?? 'agent_x') !== 'crew_private' || !session.hostCrewId) {
    return undefined;
  }

  const hostCrewId = session.hostCrewId;
  let crew = crewManager.get(hostCrewId);
  if (crew) return finalizePrivateHostCrew(session, crew);

  const callsign = session.hostCrewCallsign ?? callsignFromHostCrewId(hostCrewId);
  if (callsign) {
    crew = crewManager.list().find((c) => crewCallsignsMatch(c.callsign, callsign));
    if (crew) return finalizePrivateHostCrew(session, crew);
  }

  const catalogId = catalogIdForSession(session);
  if (catalogId && store) {
    const entry = getCatalogEntrySync(store, catalogId);
    if (entry) {
      return finalizePrivateHostCrew(
        session,
        ephemeralCrewFromCatalogEntry(entry),
        catalogEntryToCrewHints(entry),
      );
    }
  }

  return crewFromSessionSnapshot(session);
}

/** Async resolve for session restore — roster, catalog snapshot, or session fields (no roster recruit). */
export async function resolveCrewPrivateHostForSession(
  crewManager: CrewManagerLike,
  session: Session,
  store?: unknown,
): Promise<Crew | undefined> {
  const sync = resolveCrewPrivateHostForAgent(crewManager, session, store);
  if (sync) return sync;

  const catalogId = catalogIdForSession(session);
  if (catalogId && store) {
    const catalogStore = getCrewCatalogStoreFromEngine(store);
    if (catalogStore) {
      try {
        const entry = await catalogStore.getCatalogEntry(catalogId);
        if (entry) {
          return finalizePrivateHostCrew(
            session,
            ephemeralCrewFromCatalogEntry(entry),
            catalogEntryToCrewHints(entry),
          );
        }
      } catch (e) {
        getLogger().warn(
          'CREW_PRIVATE',
          `Async catalog resolve failed for ${catalogId}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }

  return crewFromSessionSnapshot(session);
}

/** @deprecated Use resolveCrewPrivateHostForSession — private chat no longer recruits to roster. */
export const ensureCrewPrivateHostOnRoster = resolveCrewPrivateHostForSession;
