import type { Request, Response } from 'express';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Crew, Session } from '@agentx/shared';
import { getDataDir, getLogger } from '@agentx/shared';
import { getEngine } from './engine.js';

function crewInfo(crew: Crew) {
  return {
    id: crew.id,
    name: crew.name,
    title: crew.title,
    callsign: crew.callsign,
    color: crew.color,
    icon: crew.icon,
    catalogId: crew.catalogId,
    categoryId: (crew as Crew & { categoryId?: string }).categoryId,
    description: crew.description,
    expertise: crew.expertise,
    traits: crew.traits,
    emotion: crew.emotion,
    tone: crew.emotion,
  };
}

function hostInputFromCrew(crew: Crew, extras?: { categoryId?: string }) {
  const ext = crew as Crew & {
    categoryId?: string;
    requiresMedicalDisclaimer?: boolean;
    honorsDoctorate?: boolean;
  };
  return {
    id: crew.id,
    name: crew.name,
    callsign: crew.callsign,
    title: crew.title,
    color: crew.color,
    catalogId: crew.catalogId ?? (crew.id.startsWith('hub-') ? crew.id : undefined),
    categoryId: extras?.categoryId ?? ext.categoryId,
    expertise: crew.expertise,
    requiresMedicalDisclaimer: ext.requiresMedicalDisclaimer,
    honorsDoctorate: ext.honorsDoctorate,
  };
}

function resolveScopePath(scopePath?: string): string {
  if (scopePath?.trim()) return scopePath.trim();
  try {
    const cfg = getEngine().configManager.load();
    const fromCfg = (cfg as { workspacePath?: string }).workspacePath;
    if (fromCfg?.trim()) return fromCfg.trim();
  } catch { /* ignore */ }
  return process.cwd();
}

function sessionToInfo(session: Session, crew?: Crew) {
  return {
    id: session.id,
    title: crew?.name ?? session.title,
    contextKind: session.contextKind ?? 'crew_private',
    hostCrewId: session.hostCrewId ?? crew?.id,
    crewId: crew?.id,
    crewName: crew?.name,
    crewTitle: crew?.title,
    crewCallsign: crew?.callsign,
    scopePath: session.scopePath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

async function enrichRecruitFromCatalog(recruit: Record<string, unknown>): Promise<Record<string, unknown>> {
  const catalogId = (recruit['catalogId'] as string | undefined)
    ?? ((recruit['id'] as string | undefined)?.startsWith('hub-') ? recruit['id'] as string : undefined);
  if (!catalogId || recruit['categoryId']) return recruit;

  try {
    const eng = getEngine();
    const store = eng.sessionManager.getStorageAdapter();
    const catalogStore = store?.getCrewCatalogStore?.();
    const entry = catalogStore ? await catalogStore.getCatalogEntry(catalogId) : null;
    if (entry?.categoryId) {
      return { ...recruit, categoryId: entry.categoryId, catalogId };
    }
  } catch { /* best-effort */ }
  return recruit;
}

function ephemeralCrewFromRecruitPayload(r: Record<string, unknown>): Crew {
  const callsign = (r['callsign'] as string)
    || String(r['name']).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const now = new Date().toISOString();
  return {
    id: (r['id'] as string) || `hub-${callsign}`,
    name: r['name'] as string,
    title: r['title'] as string | undefined,
    callsign,
    systemPrompt: r['systemPrompt'] as string,
    description: (r['description'] as string) || '',
    emotion: (r['tone'] as Crew['emotion']) ?? (r['emotion'] as Crew['emotion']),
    expertise: r['expertise'] as string[] | undefined,
    traits: r['traits'] as string[] | undefined,
    tools: r['tools'] as string[] | undefined,
    source: (r['source'] as Crew['source']) ?? (r['catalogId'] ? 'hub' : 'custom'),
    catalogId: (r['catalogId'] as string | undefined) ?? `hub-${callsign}`,
    color: r['color'] as string | undefined,
    isDefault: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function resolveOrRecruitCrew(body: {
  crewId?: string;
  recruit?: Record<string, unknown>;
}): Crew {
  const eng = getEngine();

  const r = body.recruit;
  if (r?.['name'] && r?.['systemPrompt']) {
    const callsign = (r['callsign'] as string) || String(r['name']).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const existing = eng.crewManager.list().find((c) => c.callsign.toLowerCase() === callsign.toLowerCase());
    if (existing) return existing;

    // Private crew chat: use hub identity without persisting to the global roster.
    return ephemeralCrewFromRecruitPayload(r);
  }

  if (body.crewId) {
    const crew = eng.crewManager.get(body.crewId) ?? eng.crewManager.list().find((c) => c.id === body.crewId);
    if (crew) return crew;
    throw new Error('crew-not-found');
  }

  throw new Error('crewId-or-recruit-required');
}

function findCrewPrivateSession(crewId: string): Session | null {
  const eng = getEngine();
  return eng.sessionManager.findCrewPrivateSession(crewId);
}

/** POST /api/crew-chat/sessions — create or return the crew-private session (chat uses /api/sessions + /api/chat). */
export async function postCrewChatSession(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { crewId?: string; recruit?: Record<string, unknown>; scopePath?: string };
    const eng = getEngine();

    const recruit = body.recruit ? await enrichRecruitFromCatalog(body.recruit) : undefined;
    const crew = resolveOrRecruitCrew({ crewId: body.crewId, recruit });
    const categoryId = (recruit?.['categoryId'] as string | undefined)
      ?? (body.recruit?.['categoryId'] as string | undefined);
    const host = hostInputFromCrew(crew, { categoryId });

    const cfg = eng.configManager.load();
    if (!cfg.provider.activeProvider || !cfg.provider.activeModel) {
      res.status(400).json({ error: 'no-provider' });
      return;
    }

    const scopePath = resolveScopePath(body.scopePath);
    const hadSession = !!findCrewPrivateSession(crew.id);
    const session = eng.sessionManager.createCrewPrivateSession(
      cfg.provider.activeProvider,
      cfg.provider.activeModel,
      scopePath,
      host,
    );
    const created = !hadSession;
    if (created) {
      try {
        mkdirSync(join(getDataDir(), 'sessions', session.id), { recursive: true });
      } catch { /* best-effort */ }
    }

    res.json({
      sessionId: session.id,
      created,
      crew: crewInfo(crew),
      session: sessionToInfo(session, crew),
    });
  } catch (e: unknown) {
    getLogger().error('POST_CREW_CHAT_SESSION', e instanceof Error ? e : String(e));
    res.status(400).json({ error: e instanceof Error ? e.message : 'crew-chat-session-failed' });
  }
}
