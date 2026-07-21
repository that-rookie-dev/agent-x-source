import type { Request, Response } from 'express';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { Crew, Session } from '@agentx/shared';
import {
  buildDurationDividerMeta,
  crewVoiceSessionId,
  encodeCallDividerContent,
  getDataDir,
  getLogger,
  isCrewVoiceSessionId,
  textSessionIdFromVoiceSessionId,
} from '@agentx/shared';
import { getEngine } from './engine.js';
import { getSessionDir } from './api-helpers.js';
import { persistMessageDirect } from './ws.js';
import { getActiveWorkspacePath } from './workspace.js';

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

function resolveScopePath(_scopePath?: string): string {
  return getActiveWorkspacePath();
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

/**
 * POST /api/crew-chat/voice-sessions — create or return the voice-call sibling
 * (`voice:{textSessionId}`) so call transcripts stay out of the private text chat.
 */
export async function postCrewChatVoiceSession(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as {
      crewId?: string;
      recruit?: Record<string, unknown>;
      scopePath?: string;
      /** Private text session id (UUID). Also accepts an existing `voice:{id}`. */
      textSessionId?: string;
    };
    const eng = getEngine();

    const cfg = eng.configManager.load();
    if (!cfg.provider.activeProvider || !cfg.provider.activeModel) {
      res.status(400).json({ error: 'no-provider' });
      return;
    }

    const scopePath = resolveScopePath(body.scopePath);
    let textSessionId = body.textSessionId?.trim() || '';
    if (textSessionId && isCrewVoiceSessionId(textSessionId)) {
      textSessionId = textSessionIdFromVoiceSessionId(textSessionId) ?? '';
    }

    let textSession: Session | null = null;
    if (textSessionId) {
      textSession = eng.sessionManager.getSessionById(textSessionId);
      if (!textSession || textSession.contextKind !== 'crew_private' || isCrewVoiceSessionId(textSession.id)) {
        res.status(400).json({ error: 'invalid-text-session' });
        return;
      }
    }

    const recruit = body.recruit ? await enrichRecruitFromCatalog(body.recruit) : undefined;
    let crew: Crew;
    if (body.crewId || recruit) {
      crew = resolveOrRecruitCrew({ crewId: body.crewId, recruit });
      if (textSession?.hostCrewId && textSession.hostCrewId !== crew.id) {
        res.status(400).json({ error: 'text-session-crew-mismatch' });
        return;
      }
    } else if (textSession?.hostCrewId) {
      try {
        crew = resolveOrRecruitCrew({ crewId: textSession.hostCrewId });
      } catch {
        // Ephemeral hub crews may not be on the roster — rebuild from session snapshot.
        const callsign = textSession.hostCrewCallsign || 'crew';
        crew = {
          id: textSession.hostCrewId,
          name: textSession.hostCrewName || textSession.title || callsign,
          title: textSession.hostCrewTitle || undefined,
          callsign,
          systemPrompt: '',
          description: '',
          source: 'hub',
          catalogId: textSession.hostCrewCatalogId || undefined,
          color: textSession.hostCrewColor || undefined,
          isDefault: false,
          enabled: true,
          createdAt: textSession.createdAt,
          updatedAt: textSession.updatedAt,
        };
      }
    } else {
      res.status(400).json({ error: 'crewId-or-recruit-or-textSessionId-required' });
      return;
    }

    const categoryId = (recruit?.['categoryId'] as string | undefined)
      ?? (body.recruit?.['categoryId'] as string | undefined)
      ?? textSession?.hostCrewCategoryId
      ?? undefined;
    const host = hostInputFromCrew(crew, { categoryId: categoryId || undefined });

    if (!textSessionId) {
      const createdText = eng.sessionManager.createCrewPrivateSession(
        cfg.provider.activeProvider,
        cfg.provider.activeModel,
        scopePath,
        host,
      );
      textSessionId = createdText.id;
    }

    const voiceId = crewVoiceSessionId(textSessionId);
    const hadVoice = !!eng.sessionManager.findCrewVoiceSession(textSessionId);
    const voiceSession = eng.sessionManager.createCrewVoiceSession(
      cfg.provider.activeProvider,
      cfg.provider.activeModel,
      scopePath,
      textSessionId,
      host,
    );
    const created = !hadVoice;
    if (created) {
      try {
        mkdirSync(join(getDataDir(), 'sessions', voiceSession.id), { recursive: true });
      } catch { /* best-effort */ }
    }

    res.json({
      sessionId: voiceSession.id,
      textSessionId,
      created,
      crew: crewInfo(crew),
      session: sessionToInfo(voiceSession, crew),
      voiceSessionId: voiceId,
    });
  } catch (e: unknown) {
    getLogger().error('POST_CREW_CHAT_VOICE_SESSION', e instanceof Error ? e : String(e));
    res.status(400).json({ error: e instanceof Error ? e.message : 'crew-chat-voice-session-failed' });
  }
}

/** GET /api/crew-chat/voice-sessions — call history (voice: siblings only). */
export async function listCrewChatVoiceSessions(_req: Request, res: Response): Promise<void> {
  try {
    const eng = getEngine();
    const store = eng.sessionManager.getStorageAdapter?.() ?? null;
    const getKpis = eng.sessionManager.getSessionListKpis?.bind(eng.sessionManager);
    const crewManager = eng.crewManager;
    const sessions = eng.sessionManager.listCrewVoiceSessions(100);

    const enriched = sessions.map((s) => {
      let messageCount = 0;
      try {
        if (getKpis) {
          messageCount = Number(getKpis(s.id, s)?.messageCount ?? 0);
        } else if (store?.getSessionListKpis) {
          messageCount = Number(store.getSessionListKpis(s.id, s)?.messageCount ?? 0);
        } else if (store?.getMessageCount) {
          messageCount = Number(store.getMessageCount(s.id) ?? 0);
        }
      } catch { /* best-effort */ }

      const textSessionId = textSessionIdFromVoiceSessionId(s.id);
      const hostCrewId = s.hostCrewId ?? null;
      const hostCrew = hostCrewId ? crewManager?.get(hostCrewId) : undefined;
      const callsign = s.hostCrewCallsign || hostCrew?.callsign || 'crew';
      const name = s.hostCrewName || hostCrew?.name || s.title || callsign;
      const color = s.hostCrewColor || hostCrew?.color || undefined;

      return {
        id: s.id,
        voiceSessionId: s.id,
        textSessionId,
        title: s.title || `${name} · Call`,
        contextKind: 'crew_private' as const,
        hostCrewId,
        hostCrewName: name,
        hostCrewCallsign: callsign,
        hostCrewTitle: s.hostCrewTitle || hostCrew?.title || null,
        hostCrewColor: color ?? null,
        hostCrewCatalogId: s.hostCrewCatalogId || hostCrew?.catalogId || null,
        hostCrewCategoryId: s.hostCrewCategoryId || null,
        messageCount,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        listDayKey: s.listDayKey ?? null,
        listDayLabel: s.listDayLabel ?? null,
      };
    });

    res.json({ sessions: enriched });
  } catch (e: unknown) {
    getLogger().error('LIST_CREW_CHAT_VOICE_SESSIONS', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'list-voice-sessions-failed' });
  }
}

/**
 * POST /api/crew-chat/voice-sessions/:id/dividers — persist a call-transcript
 * divider row (currently duration at hang-up). Written once; clients read as-is.
 */
export async function postCrewChatVoiceSessionDivider(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = String(req.params['id'] ?? '');
    if (!isCrewVoiceSessionId(sessionId)) {
      res.status(400).json({ error: 'not-a-voice-session' });
      return;
    }
    const eng = getEngine();
    const peek = eng.sessionManager.getSessionById(sessionId);
    if (!peek) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    if ((peek.contextKind ?? 'agent_x') !== 'crew_private') {
      res.status(400).json({ error: 'not-a-crew-call' });
      return;
    }
    const body = req.body as { variant?: string; elapsedMs?: number };
    if (body.variant !== 'duration') {
      res.status(400).json({ error: 'unsupported-divider-variant' });
      return;
    }
    const elapsedMs = Number(body.elapsedMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      res.status(400).json({ error: 'invalid-elapsed-ms' });
      return;
    }
    const meta = buildDurationDividerMeta(elapsedMs);
    persistMessageDirect(sessionId, 'user', encodeCallDividerContent(meta), {
      metadata: { callDivider: meta },
    });
    res.json({ ok: true, divider: meta });
  } catch (e: unknown) {
    getLogger().error('POST_CREW_CHAT_VOICE_DIVIDER', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'persist-divider-failed' });
  }
}

/**
 * DELETE /api/crew-chat/voice-sessions/:id — remove a call entry and its transcript
 * messages (DB cascade). Only `voice:` siblings are accepted.
 */
export async function deleteCrewChatVoiceSession(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = String(req.params['id'] ?? '');
    if (!isCrewVoiceSessionId(sessionId)) {
      res.status(400).json({ error: 'not-a-voice-session' });
      return;
    }
    const eng = getEngine();
    const peek = eng.sessionManager.getSessionById(sessionId);
    if (!peek) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    if ((peek.contextKind ?? 'agent_x') !== 'crew_private') {
      res.status(400).json({ error: 'not-a-crew-call' });
      return;
    }
    const store = eng.sessionManager.getStorageAdapter?.();
    if (!store?.deleteSession) {
      res.status(501).json({ error: 'delete-not-supported' });
      return;
    }
    store.deleteSession(sessionId);
    const dir = getSessionDir(sessionId);
    if (existsSync(dir)) {
      try { await rm(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('DELETE_CREW_CHAT_VOICE_SESSION', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-voice-session-failed' });
  }
}
