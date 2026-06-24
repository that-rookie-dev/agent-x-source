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

function resolveScopePath(scopePath?: string): string {
  if (scopePath?.trim()) return scopePath.trim();
  try {
    const cfg = getEngine().configManager.load();
    const fromCfg = (cfg as { workspacePath?: string }).workspacePath;
    if (fromCfg?.trim()) return fromCfg.trim();
  } catch { /* ignore */ }
  return process.cwd();
}

function sessionToInfo(session: Record<string, unknown>, crew?: Crew) {
  return {
    id: session['id'],
    title: crew?.name ?? session['title'],
    contextKind: session['contextKind'] ?? 'crew_private',
    hostCrewId: session['hostCrewId'] ?? crew?.id,
    crewId: crew?.id,
    crewName: crew?.name,
    crewTitle: crew?.title,
    crewCallsign: crew?.callsign,
    scopePath: session['scopePath'],
    createdAt: session['createdAt'],
    updatedAt: session['updatedAt'],
  };
}

function resolveOrRecruitCrew(body: {
  crewId?: string;
  recruit?: Record<string, unknown>;
}): Crew {
  const eng = getEngine();

  if (body.crewId) {
    const crew = eng.crewManager.get(body.crewId) ?? eng.crewManager.list().find((c) => c.id === body.crewId);
    if (crew) return crew;
    throw new Error('crew-not-found');
  }

  const r = body.recruit;
  if (!r?.['name'] || !r?.['systemPrompt']) {
    throw new Error('crewId-or-recruit-required');
  }

  const callsign = (r['callsign'] as string) || String(r['name']).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const existing = eng.crewManager.list().find((c) => c.callsign.toLowerCase() === callsign.toLowerCase());
  if (existing) return existing;

  return eng.crewManager.create({
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
    catalogId: r['catalogId'] as string | undefined,
  });
}

function findCrewPrivateSession(crewId: string): Session | null {
  const eng = getEngine();
  const mgr = eng.sessionManager as unknown as {
    findCrewPrivateSession?: (id: string) => Session | null;
  };
  return mgr.findCrewPrivateSession?.(crewId) ?? null;
}

/** POST /api/crew-chat/sessions — create or return the crew-private session (chat uses /api/sessions + /api/chat). */
export function postCrewChatSession(req: Request, res: Response): void {
  try {
    const body = req.body as { crewId?: string; recruit?: Record<string, unknown>; scopePath?: string };
    const eng = getEngine();

    const crew = resolveOrRecruitCrew(body);
    const cfg = eng.configManager.load();
    if (!cfg.provider.activeProvider || !cfg.provider.activeModel) {
      res.status(400).json({ error: 'no-provider' });
      return;
    }

    const scopePath = resolveScopePath(body.scopePath);
    const existing = findCrewPrivateSession(crew.id);
    let session: Session;
    let created = false;

    if (existing) {
      session = existing;
    } else {
      session = eng.sessionManager.createCrewPrivateSession(
        cfg.provider.activeProvider,
        cfg.provider.activeModel,
        scopePath,
        { id: crew.id, name: crew.name, callsign: crew.callsign, title: crew.title },
      );
      created = true;
      try {
        mkdirSync(join(getDataDir(), 'sessions', session.id), { recursive: true });
      } catch { /* best-effort */ }
    }

    res.json({
      sessionId: session.id,
      created,
      crew: crewInfo(crew),
      session: sessionToInfo(session as unknown as Record<string, unknown>, crew),
    });
  } catch (e: unknown) {
    getLogger().error('POST_CREW_CHAT_SESSION', e instanceof Error ? e : String(e));
    res.status(400).json({ error: e instanceof Error ? e.message : 'crew-chat-session-failed' });
  }
}
