import type { Request, Response } from 'express';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Crew, Session } from '@agentx/shared';
import { getDataDir, getLogger } from '@agentx/shared';
import { getEngine } from './engine.js';
import {
  applySessionModeToAgent,
  buildFullText,
  buildInstructionForMode,
  ensureCrewPrivateAgentForSession,
  handleAgentMessageStream,
} from './chat-helpers.js';

const DEFAULT_PAGE_SIZE = 50;

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

function getMessageStore(eng: ReturnType<typeof getEngine>) {
  return (eng.sessionManager as unknown as {
    store?: {
      getMessages?: (id: string) => Array<Record<string, unknown>>;
      getMessagesPage?: (id: string, opts: { limit?: number; before?: string }) => {
        messages: Array<Record<string, unknown>>;
        total: number;
        hasMore: boolean;
      };
    };
  }).store;
}

function normalizeMessagesForUi(
  messages: Array<Record<string, unknown>>,
  crew: Crew,
): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    const out: Record<string, unknown> = {
      ...msg,
      id: msg['id'],
      role: msg['role'],
      content: msg['content'],
      createdAt: msg['created_at'] ?? msg['createdAt'],
    };
    if (msg['role'] === 'assistant') {
      const meta = typeof msg['metadata'] === 'string'
        ? (() => { try { return JSON.parse(msg['metadata'] as string); } catch { return {}; } })()
        : (msg['metadata'] as Record<string, unknown> | undefined) ?? {};
      out['crew'] = {
        crewId: (meta['crewId'] as string) ?? crew.id,
        name: (meta['crewName'] as string) ?? crew.name,
        callsign: (meta['callsign'] as string) ?? crew.callsign,
        color: crew.color,
        icon: crew.icon,
      };
    }
    return out;
  });
}

function loadMessagesPage(
  eng: ReturnType<typeof getEngine>,
  sessionId: string,
  limit: number,
  before?: string,
) {
  const store = getMessageStore(eng);
  if (store?.getMessagesPage) {
    return store.getMessagesPage(sessionId, { limit, before });
  }
  const all = (store?.getMessages?.(sessionId) ?? []).filter(
    (m) => m['role'] === 'user' || m['role'] === 'assistant',
  );
  let slice = all;
  if (before) {
    const idx = all.findIndex((m) => m['id'] === before);
    slice = idx > 0 ? all.slice(0, idx) : [];
  }
  const page = slice.slice(-limit);
  return { messages: page, total: all.length, hasMore: slice.length > page.length };
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

function resolveCanonicalSessionForCrew(crewId: string): Session | null {
  const eng = getEngine();
  const mgr = eng.sessionManager as unknown as {
    resolveCanonicalCrewPrivateSession?: (id: string) => Session | null;
    findCrewPrivateSession?: (id: string) => Session | null;
  };
  return mgr.resolveCanonicalCrewPrivateSession?.(crewId) ?? mgr.findCrewPrivateSession?.(crewId) ?? null;
}

function resolveCrewPrivateSession(sessionId: string): { session: Session; crew: Crew } {
  const eng = getEngine();
  let session = eng.sessionManager.getSessionById(sessionId);
  if (!session) throw new Error('not-found');
  if ((session.contextKind ?? 'agent_x') !== 'crew_private') throw new Error('not-crew-private-session');

  const hostCrewId = session.hostCrewId as string;
  const canonical = resolveCanonicalSessionForCrew(hostCrewId);
  if (canonical && canonical.id !== session.id) session = canonical;

  const crew = eng.crewManager.get(hostCrewId);
  if (!crew) throw new Error('crew-not-found');

  return { session, crew };
}

/** POST /api/crew-chat/sessions — start or resume private chat with a crew member */
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
    const existing = resolveCanonicalSessionForCrew(crew.id);
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

/** GET /api/crew-chat/sessions/:sessionId — paginated history (read-only; Agent activates on send) */
export function getCrewChatSession(req: Request, res: Response): void {
  try {
    const sessionId = req.params['sessionId']!;
    const limit = Math.min(Math.max(Number(req.query['limit'] ?? DEFAULT_PAGE_SIZE), 1), 200);
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : undefined;
    const eng = getEngine();

    const { session, crew } = resolveCrewPrivateSession(sessionId);
    const page = loadMessagesPage(eng, session.id, limit, before);
    const messages = normalizeMessagesForUi(page.messages, crew);

    res.json({
      session: sessionToInfo(session as unknown as Record<string, unknown>, crew),
      crew: crewInfo(crew),
      messages,
      pagination: {
        total: page.total,
        hasMore: page.hasMore,
        limit,
        before: before ?? null,
        oldestId: messages[0]?.['id'] ?? null,
      },
      canonicalSessionId: session.id,
      redirected: session.id !== sessionId,
    });
  } catch (e: unknown) {
    getLogger().error('GET_CREW_CHAT_SESSION', e instanceof Error ? e : String(e));
    const msg = e instanceof Error ? e.message : 'restore-failed';
    const status = msg === 'not-found' ? 404 : msg === 'not-crew-private-session' ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}

/** GET /api/crew-chat/sessions/:sessionId/messages — load older messages */
export function getCrewChatMessages(req: Request, res: Response): void {
  try {
    const sessionId = req.params['sessionId']!;
    const limit = Math.min(Math.max(Number(req.query['limit'] ?? DEFAULT_PAGE_SIZE), 1), 200);
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : undefined;
    if (!before) {
      res.status(400).json({ error: 'before-cursor-required' });
      return;
    }

    const eng = getEngine();
    const { session, crew } = resolveCrewPrivateSession(sessionId);
    const page = loadMessagesPage(eng, session.id, limit, before);
    const messages = normalizeMessagesForUi(page.messages, crew);

    res.json({
      messages,
      pagination: {
        total: page.total,
        hasMore: page.hasMore,
        limit,
        before,
        oldestId: messages[0]?.['id'] ?? null,
      },
    });
  } catch (e: unknown) {
    getLogger().error('GET_CREW_CHAT_MESSAGES', e instanceof Error ? e : String(e));
    res.status(404).json({ error: e instanceof Error ? e.message : 'messages-failed' });
  }
}

/** POST /api/crew-chat/sessions/:sessionId/message — sync send via unified Agent */
export async function postCrewChatMessage(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = req.params['sessionId']!;
    const { text } = req.body as { text: string };
    if (!text?.trim()) {
      res.status(400).json({ error: 'text-required' });
      return;
    }

    const { crew, session } = resolveCrewPrivateSession(sessionId);
    const agent = ensureCrewPrivateAgentForSession(session.id);
    if (agent.processing) {
      res.status(503).json({ error: 'crew-chat-busy' });
      return;
    }

    const mode = applySessionModeToAgent(agent);
    const fullText = buildFullText(text);
    const instruction = buildInstructionForMode(mode);
    const message = await agent.sendMessage(fullText, { instruction });

    res.json({
      ok: true,
      content: message.content,
      assistantMessageId: message.id,
      elapsed: 0,
      crew: crewInfo(crew),
    });
  } catch (e: unknown) {
    getLogger().error('POST_CREW_CHAT_MESSAGE', e instanceof Error ? e : String(e));
    const msg = e instanceof Error ? e.message : 'crew-chat-message-failed';
    const status = msg === 'crew-chat-busy' ? 503 : msg === 'not-found' ? 404 : 500;
    res.status(status).json({ error: msg });
  }
}

/** POST /api/crew-chat/sessions/:sessionId/message-stream — SSE via unified Agent */
export async function postCrewChatMessageStream(req: Request, res: Response): Promise<void> {
  try {
    const sessionId = req.params['sessionId']!;
    const { text, retry } = req.body as { text: string; retry?: boolean };
    if (!text?.trim()) {
      res.status(400).json({ error: 'text-required' });
      return;
    }

    const { crew, session } = resolveCrewPrivateSession(sessionId);
    const agent = ensureCrewPrivateAgentForSession(session.id);

    await handleAgentMessageStream(res, agent, {
      text,
      retry,
      skipCrewSuggestion: true,
      connectedPayload: { sessionId: session.id, crewId: crew.id },
    });
  } catch (e: unknown) {
    if (!res.headersSent) {
      getLogger().error('POST_CREW_CHAT_MESSAGE_STREAM', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'crew-chat-stream-failed' });
    }
  }
}

/** POST /api/crew-chat/sessions/:sessionId/retry — drop last exchange for retry */
export function postCrewChatRetry(req: Request, res: Response): void {
  try {
    const sessionId = req.params['sessionId']!;
    const { session } = resolveCrewPrivateSession(sessionId);
    const eng = getEngine();
    const store = (eng.sessionManager as unknown as {
      store?: { deleteLastMessages?: (id: string, n: number, roles?: string[]) => void };
    }).store;
    store?.deleteLastMessages?.(session.id, 2, ['user', 'assistant']);
    const agent = ensureCrewPrivateAgentForSession(session.id);
    try { agent.rebuildContext(); } catch { /* best-effort */ }
    res.json({ ok: true, narrativeEntries: 0 });
  } catch (e: unknown) {
    getLogger().error('POST_CREW_CHAT_RETRY', e instanceof Error ? e : String(e));
    res.status(400).json({ error: e instanceof Error ? e.message : 'crew-chat-retry-failed' });
  }
}

/** POST /api/crew-chat/sessions/:sessionId/cancel — abort in-flight turn */
export function postCrewChatCancel(req: Request, res: Response): void {
  try {
    const sessionId = req.params['sessionId']!;
    const { session } = resolveCrewPrivateSession(sessionId);
    const agent = ensureCrewPrivateAgentForSession(session.id);
    agent.cancel();
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_CREW_CHAT_CANCEL', e instanceof Error ? e : String(e));
    res.status(400).json({ error: e instanceof Error ? e.message : 'crew-chat-cancel-failed' });
  }
}

/** GET /api/crew-chat/by-crew/:crewId — find the single private session for a crew */
export function getCrewChatByCrew(req: Request, res: Response): void {
  try {
    const crewId = req.params['crewId']!;
    const eng = getEngine();
    const crew = eng.crewManager.get(crewId);
    const session = resolveCanonicalSessionForCrew(crewId);
    if (!session) {
      res.json({ sessionId: null, crew: crew ? crewInfo(crew) : null });
      return;
    }
    res.json({
      sessionId: session.id,
      crew: crew ? crewInfo(crew) : null,
      session: sessionToInfo(session as unknown as Record<string, unknown>, crew ?? undefined),
    });
  } catch (e: unknown) {
    getLogger().error('GET_CREW_CHAT_BY_CREW', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'lookup-failed' });
  }
}
