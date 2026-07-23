/**
 * Sessions route group (CRUD, context, checkpoints, feedback, search, export).
 *
 * Extracted from legacy.ts. Registers handlers on a dedicated Router and
 * exports createSessionsRouter() for mounting by the legacy aggregator.
 */
import { Router } from 'express';
import { join, resolve } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import {
  getLogger,
  normalizeMessageForUi,
  isUserFacingSession,
  isAutomationSessionId,
  isChannelSessionId,
  isMemoryFabricSuperSession,
  resolveMemoryFabricSearchSessionFilter,
} from '@agentx/shared';
import type { Crew, CompletionRequest, SessionEvent, SessionListKpis, StorableMessage } from '@agentx/shared';
import { EMPTY_SESSION_KPIS } from '@agentx/shared';
import { getEngine, createAgent, destroyAgent, getOrCreateBoundSessionAgent } from '../../engine.js';
import { getActiveWorkspacePath } from '../../workspace.js';
import { getMemoryFabricInstance, ProviderFactory, getSubAgentServiceInstance, type Agent } from '@agentx/engine';
import {
  loadSessionMessagesPage,
  loadTurnFeedbackForSession,
  recordTurnFeedback,
  isCrewPrivateSessionRecord,
} from '../../chat-helpers.js';
import { enrichSessionMessagesForUi, mergeNormalizedMessageForApi } from '../../message-enrich.js';
import {
  validate,
  clarificationRespondSchema,
  generateTitleSchema,
  createSessionSchema,
  turnFeedbackSchema,
  createCheckpointSchema,
  sessionMessagesQuerySchema,
} from '../../validation.js';
import { ensureSubscribed } from '../../ws.js';
import { handleClarificationRespond } from '../../clarification-resume.js';
import { loadSessionResumeState } from '../../session-resume-state.js';
import {
  resolveHostCrewDisplay,
  resolveCrewPrivateHostForSession,
  syncHostCrewHonorificToSession,
} from '../../host-crew-session.js';
import { getSessionDir, pathExists, ensureSessionDir, atomicWriteFileSync } from './shared.js';
import { turnRegistry } from '../../turn-registry.js';

export function createSessionsRouter(): Router {
  const r = Router();

  /** Compute a lightweight turn-status snapshot for a session, if any active/recent turn exists. */
  function getTurnStatusForSession(sessionId: string): { status: string; turnId: string; startedAt: number } | null {
    try {
      const rec = turnRegistry.getBySessionId(sessionId);
      if (!rec) return null;
      return { status: rec.status, turnId: rec.turnId, startedAt: rec.startedAt };
    } catch { return null; }
  }

  function resolveSessionAgent(sessionId: string): Agent | null {
    const eng = getEngine();
    if (eng.agent?.sessionId === sessionId) return eng.agent;
    const session = eng.sessionManager.getSessionById(sessionId);
    if (!session) return null;
    return getOrCreateBoundSessionAgent(session);
  }

  r.post('/api/clarification/respond', validate(clarificationRespondSchema), async (req, res) => {
    try {
      const { response, sessionId } = req.body as { response: string; sessionId?: string };
      const result = await handleClarificationRespond(response, sessionId);
      if (!result.ok) {
        res.status(result.status ?? 500).json({ error: result.error ?? 'clarification-respond-failed' });
        return;
      }
      res.json({ ok: true, resumed: result.resumed ?? false });
    } catch (e) {
      getLogger().error('CLARIFICATION_RESPOND', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'clarification-respond-failed' });
    }
  });

  r.get('/api/sessions/analytics', (_req, res) => {
    try {
      const eng = getEngine();
      const sessions = eng.sessionManager.listSessions(100);
      const total = sessions.length;
      const active = sessions.filter((s) => s.status === 'active').length;
      const tokens = sessions.reduce((sum, s) => sum + (s.tokenUsed || 0), 0);
      const byProvider: Record<string, number> = {};
      for (const s of sessions) {
        const p = s.providerId || 'unknown';
        byProvider[p] = (byProvider[p] || 0) + 1;
      }
      res.json({
        total, active, totalTokens: tokens,
        avgTokens: total > 0 ? Math.round(tokens / total) : 0,
        byProvider,
        recent: sessions.slice(0, 5).map((s) => ({
          id: s.id, title: s.title, tokenUsed: s.tokenUsed, createdAt: s.createdAt,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'analytics-failed' });
    }
  });

  r.get('/api/sessions', (_req, res) => {
    try {
      const eng = getEngine();
      const all = typeof eng.sessionManager.listRootSessions === 'function'
        ? eng.sessionManager.listRootSessions(100)
        : eng.sessionManager.listSessions(100);
      const sessions = all.filter((s) => isUserFacingSession({
        id: String(s.id ?? ''),
        parentId: s.parentId ?? null,
        contextKind: s.contextKind ?? 'agent_x',
      }));
      const store = eng.sessionManager.getStorageAdapter?.() ?? null;
      const getKpis = eng.sessionManager.getSessionListKpis?.bind(eng.sessionManager);
      const crewManager = eng.crewManager;

      const enriched = sessions.map((s) => {
        const id = s.id;
        let kpis: SessionListKpis | null = null;
        try {
          if (getKpis) {
            kpis = getKpis(id, s);
          } else if (store?.getSessionListKpis) {
            kpis = store.getSessionListKpis(id, s);
          } else if (store?.getMessageCount) {
            kpis = { ...EMPTY_SESSION_KPIS, messageCount: store.getMessageCount(id) };
          }
        } catch { kpis = null; }

        const rawCallsigns = kpis?.crewCallsigns ?? [];
        const crewCallsigns = rawCallsigns.map((crewId) => {
          const crew = crewManager?.get(crewId);
          return crew?.callsign ?? crew?.name ?? crewId;
        });

        const tokensUsed = Number(kpis?.tokensUsed ?? s.tokenUsed ?? 0);
        const tokenAvailable = Number(kpis?.tokenAvailable ?? s.tokenAvailable ?? 128_000);
        const contextKind = s.contextKind ?? 'agent_x';
        const hostCrewId = s.hostCrewId ?? null;
        const hostCrew = hostCrewId ? crewManager?.get(hostCrewId) : undefined;
        const hostDisplay = contextKind === 'crew_private'
          ? resolveHostCrewDisplay(s, hostCrew)
          : null;

        const rawTitle = s.title;
        const displayTitle = contextKind === 'crew_private' && hostDisplay?.hostCrewName && (
          !rawTitle
          || rawTitle === s.hostCrewName
          || rawTitle === hostCrew?.name
        ) ? hostDisplay.hostCrewName : rawTitle;

        return {
          id: s.id,
          title: displayTitle,
          status: s.status,
          provider: s.providerId,
          model: s.modelId,
          scopePath: s.scopePath,
          parentId: s.parentId ?? null,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          tokensUsed,
          tokenAvailable,
          tokenUsagePct: kpis?.tokenUsagePct ?? (tokenAvailable > 0 ? Math.min(100, Math.round((tokensUsed / tokenAvailable) * 100)) : 0),
          messageCount: kpis?.messageCount ?? 0,
          childSessionCount: kpis?.childSessionCount ?? 0,
          crewCount: crewCallsigns.length,
          crewCallsigns,
          totalCostUsd: kpis?.totalCostUsd ?? 0,
          compactionCount: kpis?.compactionCount ?? 0,
          contextKind,
          hostCrewId,
          hostCrewName: hostDisplay?.hostCrewName ?? null,
          hostCrewCallsign: hostDisplay?.hostCrewCallsign ?? null,
          hostCrewTitle: hostDisplay?.hostCrewTitle ?? null,
          hostCrewColor: hostDisplay?.hostCrewColor ?? null,
          hostCrewCatalogId: hostDisplay?.hostCrewCatalogId ?? null,
          hostCrewCategoryId: hostDisplay?.hostCrewCategoryId ?? null,
          crewId: hostCrewId,
          turnStatus: getTurnStatusForSession(id),
        };
      });

      enriched.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      res.json(enriched);
    } catch (e: unknown) {
      getLogger().error('GET_API_SESSIONS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'failed-to-list-sessions' });
    }
  });

  r.get('/api/sessions/:id/children', (req, res) => {
    try {
      const eng = getEngine();
      const parentId = req.params['id']!;
      const children = typeof eng.sessionManager.getChildSessions === 'function'
        ? eng.sessionManager.getChildSessions(parentId)
        : [];
      res.json({ children });
    } catch (e: unknown) {
      getLogger().error('GET_API_SESSION_CHILDREN', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'failed-to-list-children' });
    }
  });

  r.get('/api/sessions/:id/preview', (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter?.();
      if (!store?.getMessages) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      const rawMessages = store.getMessages(sessionId);
      const messages = rawMessages
        .filter((m) => m['role'] !== 'part' && m['role'] !== 'system')
        .map((msg) => {
          const normalized = normalizeMessageForUi(msg, []);
          return {
            id: msg['id'],
            role: msg['role'],
            content: normalized.content,
            parts: normalized.parts,
            createdAt: msg['createdAt'],
          };
        });
      // Include tool parts for live sub-agent drawers (role=part rows + message_parts table).
      const partRows = rawMessages
        .filter((m) => m['role'] === 'part')
        .map((m) => ({
          type: (m as { type?: string }).type ?? 'part',
          toolName: (m as { toolName?: string }).toolName,
          toolSuccess: (m as { toolSuccess?: boolean }).toolSuccess,
          content: typeof m['content'] === 'string' ? m['content'] : '',
          toolResult: (m as { toolResult?: string }).toolResult,
          createdAt: m['createdAt'],
        }));
      let adapterParts: Array<Record<string, unknown>> = [];
      try {
        const getParts = (store as { getParts?: (sid: string) => Array<Record<string, unknown>> }).getParts;
        if (typeof getParts === 'function') {
          adapterParts = getParts(sessionId) ?? [];
        }
      } catch { /* optional */ }
      const parts = [...partRows, ...adapterParts].slice(-80);
      const session = eng.sessionManager.listSessions(9999).find((s) => s.id === sessionId);
      res.json({
        session: session ?? { id: sessionId, title: 'Background work', parentId: null },
        messages,
        parts,
      });
    } catch (e: unknown) {
      getLogger().error('GET_API_SESSION_PREVIEW', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'preview-failed' });
    }
  });

  r.post('/api/sessions/:id/generate-title', validate(generateTitleSchema), async (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const eng = getEngine();
      const cfg = eng.configManager.load();
      const providerId = cfg.provider.activeProvider;
      if (!providerId) { res.json({ title: '' }); return; }
      const providerCfg = cfg.provider.providers[providerId];
      const apiKey = providerCfg?.apiKey || providerCfg?.profiles?.[providerCfg?.activeProfile ?? '']?.apiKey;
      if (!apiKey) { res.json({ title: '' }); return; }

      const store = eng.sessionManager.getStorageAdapter?.();
      if (!store?.getMessages) { res.json({ title: '' }); return; }
      const messages = store.getMessages(sessionId) as Array<{ role: string; content: string }>;
      const firstUser = messages.find((m) => m.role === 'user');
      if (!firstUser) { res.json({ title: '' }); return; }

      const { ProviderFactory } = await import('@agentx/engine');
      const provider = ProviderFactory.create(providerId, apiKey, providerCfg?.baseUrl);
      const modelId = cfg.provider.activeModel || 'gpt-4o-mini';

      const titlePrompt = `Generate a brief, natural title for this conversation based on the user's first message. Rules:
  - ≤60 characters
  - Grammatically correct, no word salad
  - Focus on the main topic or question
  - Use the same language as the user
  - No tool names, no "analyzing" or "generating" prefixes
  - Output ONLY the title, nothing else

  User message: "${firstUser.content.slice(0, 500)}"`;

      const chunks: string[] = [];
      for await (const chunk of provider.complete({
        messages: [{ role: 'user', content: titlePrompt }],
        model: modelId,
        stream: true,
        maxTokens: 50,
        temperature: 0.5,
      })) {
        if (chunk.type === 'text_delta' && chunk.content) chunks.push(chunk.content);
      }
      const title = chunks.join('').trim().replace(/^["']|["']$/g, '').slice(0, 60);

      if (title) {
        eng.sessionManager.updateSession({ title });
      }
      res.json({ title });
    } catch {
      res.json({ title: '' });
    }
  });

  r.get('/api/sessions/search', (req, res) => {
    try {
      const q = String(req.query['q'] ?? '').trim();
      if (!q) { res.json({ results: [] }); return; }
      const needle = q.toLowerCase();
      const eng = getEngine();
      const sessions = eng.sessionManager.listRootSessions(200);
      const store = eng.sessionManager.getStorageAdapter?.();
      const results: Array<{ sessionId: string; title?: string; createdAt?: string; snippet: string; matchCount: number }> = [];
      for (const s of sessions) {
        const sid = s.id;
        if (!sid || !isUserFacingSession({
          id: sid,
          parentId: s.parentId ?? null,
          contextKind: s.contextKind ?? 'agent_x',
        })) continue;

        let messages: Array<{ role?: string; content?: string }> = [];
        try {
          if (store?.getMessages) {
            messages = store.getMessages(sid) as Array<{ role?: string; content?: string }>;
          }
        } catch (e) { continue; }

        let matchCount = 0;
        let snippet = '';
        for (const m of messages) {
          const c = String(m.content ?? '');
          const lc = c.toLowerCase();
          if (lc.includes(needle)) {
            matchCount++;
            if (!snippet) {
              const idx = lc.indexOf(needle);
              const start = Math.max(0, idx - 40);
              const end = Math.min(c.length, idx + needle.length + 80);
              snippet = (start > 0 ? '…' : '') + c.slice(start, end) + (end < c.length ? '…' : '');
            }
          }
        }
        if (matchCount > 0) {
          results.push({
            sessionId: sid,
            title: s.title,
            createdAt: s.createdAt,
            snippet,
            matchCount,
          });
        }
      }
      results.sort((a, b) => b.matchCount - a.matchCount);
      res.json({ results: results.slice(0, 50) });
    } catch (e: unknown) {
      getLogger().error('GET_API_SESSIONS_SEARCH', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'search-failed' });
    }
  });

  r.post('/api/config/reload', (_req, res) => {
    const eng = getEngine();
    try {
      eng.configManager.reload();
      const config = eng.configManager.load();
      res.json({ ok: true, setupComplete: config.setupComplete });
    } catch (err) {
      getLogger().error('POST_API_CONFIG_RELOAD', err instanceof Error ? err : String(err));    res.status(500).json({
        ok: false,
        error: `Failed to reload config: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  r.get('/api/sessions/:id/export', async (req, res) => {
    try {
      const sid = req.params['id']!;
      const eng = getEngine();
      const dir = getSessionDir(sid);
      if (!(await pathExists(dir))) { res.status(404).json({ error: 'not-found' }); return; }
      let messages: unknown[] = [];
      try {
        const store = eng.sessionManager.getStorageAdapter?.();
        if (store?.getMessages) {
          messages = store.getMessages(sid);
        }
      } catch (e) { /* empty */ }
      const ctxFiles = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
      const contextFiles: Record<string, string> = {};
      for (const f of ctxFiles) {
        try { contextFiles[f.replace('.txt', '')] = await readFile(join(dir, f), 'utf-8'); } catch (e) { /* skip */ }
      }
      const checkpoints: Array<{ id: string; label?: string; createdAt?: string; messageCount?: number }> = [];
      try {
        const store = eng.sessionManager.getStorageAdapter?.();
        if (store?.listCheckpoints) {
          checkpoints.push(...store.listCheckpoints(sid));
        }
      } catch (e) { /* skip */ }
      const exportData = {
        sessionId: sid,
        exportedAt: new Date().toISOString(),
        version: '1.0',
        messageCount: messages.length,
        messages,
        contextFiles,
        checkpoints,
      };
      res.setHeader('Content-Disposition', `attachment; filename="agentx-session-${sid.slice(0, 8)}-${Date.now()}.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(exportData, null, 2));
    } catch (e: unknown) {
      getLogger().error('GET_API_SESSIONS_ID_EXPORT', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'export-failed' });
    }
  });

  r.post('/api/sessions', validate(createSessionSchema), (_req, res) => {
    try {
      destroyAgent();
      const eng = getEngine();
      const cfg = eng.configManager.load();
      // All sessions share the global Agent-X Workspace (body.scopePath ignored).
      const scopePath = getActiveWorkspacePath(cfg);
      const session = eng.sessionManager.createSession(
        cfg.provider.activeProvider,
        cfg.provider.activeModel,
        scopePath,
      );
      createAgent(undefined, session);
      ensureSubscribed();
      res.json({ sessionId: session.id });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'create-failed' });
    }
  });

  r.get('/api/sessions/:id', (req, res) => {
    const eng = getEngine();
    const session = eng.sessionManager.getSessionById(req.params['id']!);
    if (!session) { res.status(404).json({ error: 'not-found' }); return; }
    if ((session.contextKind ?? 'agent_x') === 'crew_private' && session.hostCrewId) {
      const hostCrew = eng.crewManager.get(session.hostCrewId);
      const display = resolveHostCrewDisplay(session, hostCrew);
      res.json({
        ...session,
        ...display,
        title: display.hostCrewName && (
          !session.title || session.title === session.hostCrewName || session.title === hostCrew?.name
        ) ? display.hostCrewName : session.title,
      });
      return;
    }
    res.json(session);
  });

  r.delete('/api/sessions/:id', async (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const eng = getEngine();
      const peek = eng.sessionManager.getSessionById(sessionId);
      if (peek?.contextKind === 'agent_x_core') {
        res.status(403).json({ error: 'core-session-protected' });
        return;
      }
      const store = eng.sessionManager.getStorageAdapter?.();
      store.deleteSession(sessionId);
      // Clean up session folder on disk
      const dir = getSessionDir(req.params['id']!);
      if (await pathExists(dir)) {
        try { await rm(dir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
      }
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('DELETE_API_SESSIONS_ID', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'delete-failed' });
    }
  });

  r.post('/api/sessions/:id/archive-messages', (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const eng = getEngine();
      const peek = eng.sessionManager.getSessionById(sessionId);
      if (!peek) { res.status(404).json({ error: 'not-found' }); return; }
      const store = eng.sessionManager.getStorageAdapter?.();
      if (!store.archiveSessionMessages) {
        res.status(501).json({ error: 'archive-not-supported' });
        return;
      }
      store.archiveSessionMessages(sessionId);
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('ARCHIVE_SESSION_MESSAGES', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'archive-failed' });
    }
  });

  r.post('/api/sessions/:id/purge-content', async (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const eng = getEngine();
      const peek = eng.sessionManager.getSessionById(sessionId);
      if (!peek) { res.status(404).json({ error: 'not-found' }); return; }
      if (!isMemoryFabricSuperSession(sessionId, peek.contextKind)) {
        res.status(403).json({ error: 'super-session-only' });
        return;
      }
      const store = eng.sessionManager.getStorageAdapter?.();
      if (!store.purgeSessionContent) {
        res.status(501).json({ error: 'purge-not-supported' });
        return;
      }
      store.purgeSessionContent(sessionId);

      const fabric = getMemoryFabricInstance();
      let memoryWiped = { deletedNodes: 0, deletedEdges: 0 };
      if (fabric) {
        const scope = resolveMemoryFabricSearchSessionFilter(sessionId, peek.contextKind);
        memoryWiped = await fabric.wipeMemoryForSessionScope(scope);
      }

      const agent = eng.agent;
      if (agent && agent.sessionId === sessionId) {
        agent.clearHistory();
        agent.clearClarificationResumeState?.();
        try {
          eng.sessionManager.persistSessionFields(sessionId, { tokensUsed: 0, compactionCount: 0 });
        } catch { /* best-effort */ }
      }

      getLogger().info(
        'PURGE_SUPER_SESSION',
        `session=${sessionId.slice(0, 8)} nodes=${memoryWiped.deletedNodes} edges=${memoryWiped.deletedEdges}`,
      );
      res.json({ ok: true, memoryWiped });
    } catch (e) {
      getLogger().error('PURGE_SUPER_SESSION', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'purge-failed' });
    }
  });

  r.post('/api/sessions/:id/restore', async (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const perRoleRaw = (req.body as { perRole?: number } | undefined)?.perRole;
      const perRole = typeof perRoleRaw === 'number'
        ? Math.min(50, Math.max(1, Math.floor(perRoleRaw)))
        : undefined;
      if (isChannelSessionId(sessionId) || isAutomationSessionId(sessionId)) {
        res.status(403).json({ error: 'internal-session' });
        return;
      }
      const eng = getEngine();
      const peek = eng.sessionManager.getSessionById(sessionId);
      if (!peek) { res.status(404).json({ error: 'not-found' }); return; }
      const existingAgent = eng.agent;
      // Keep the agent alive when it's the same session — even if it's
      // processing. Destroying a processing agent loses all in-memory turn
      // state (thoughts, tool calls, responses) and forces a bare "executing"
      // indicator with no context. The UI reconnects to the SSE stream to
      // resume the live view.
      const keepAgent = !!existingAgent
        && existingAgent.sessionId === sessionId;
      if (!keepAgent) {
        destroyAgent();
      }
      const session = eng.sessionManager.restoreSession(sessionId);
      if (!session) { res.status(404).json({ error: 'not-found' }); return; }
      if (isCrewPrivateSessionRecord(session) && session.hostCrewId) {
        const store = eng.sessionManager.getStorageAdapter?.();
        const crew = await resolveCrewPrivateHostForSession(eng.crewManager, session, store);
        if (crew) {
          const patch = syncHostCrewHonorificToSession(session, crew);
          if (patch) {
            eng.sessionManager.patchSession(session.id, patch);
            Object.assign(session, patch);
          }
        }
      }
      if (!keepAgent) {
        createAgent(undefined, session);
      }
      const resumeState = loadSessionResumeState(sessionId);
      ensureSubscribed();
      // Check for interrupted task (task_started without task_completed)
      let interruptedTask: Record<string, unknown> | null = null;
      try {
        const events = eng.sessionManager.getSessionEvents?.(sessionId) ?? [];
        let lastTaskStarted: SessionEvent | null = null;
        let taskCompleted = false;
        for (const ev of events) {
          if (ev.type === 'task_started') lastTaskStarted = ev;
          if (ev.type === 'task_completed' && lastTaskStarted && lastTaskStarted.type === 'task_started' && ev.payload.taskId === lastTaskStarted.payload.taskId) {
            taskCompleted = true;
          }
        }
        if (lastTaskStarted && !taskCompleted && lastTaskStarted.type === 'task_started') {
          getLogger().info('RESTORE', `Session ${sessionId.slice(0, 12)} has interrupted task: ${lastTaskStarted.payload.goal.slice(0, 60)}`);
          // Also check for persisted task snapshot
          try {
            const snapshot = eng.sessionManager.getStorageAdapter?.().getTaskSnapshot?.(sessionId);
            if (snapshot) {
              interruptedTask = {
                goal: lastTaskStarted.payload.goal || String(snapshot['goal'] || ''),
                taskId: String(snapshot['task_id'] || ''),
                stepIndex: Number(snapshot['step_index'] || 0),
                hasPersistedState: true,
              };
            }
          } catch { /* best-effort */ }
        }
      } catch { /* best-effort */ }
      // Restore crew states from session store
      const crewStates = eng.sessionManager.getCrewStates();
      for (const state of crewStates) {
        const agent = eng.agent;
        if (agent) {
          agent.setCrewEnabled(state.crewId, state.enabled);
        }
      }
      // Read messages from DB using pagination so we never load the whole session history on restore.
      let messages: Array<Record<string, unknown> | StorableMessage> = [];
      let parts: Array<Record<string, unknown>> = [];
      let messageTotal = 0;
      let messagesTruncated = false;
      try {
        const page = await loadSessionMessagesPage(sessionId, { limit: perRole != null ? perRole * 2 : 50 });
        messages = page.messages;
        messageTotal = page.total;
        messagesTruncated = page.hasMore;
        const store = eng.sessionManager.getStorageAdapter?.();
        if (store?.getPartsForMessages) {
          parts = await store.getPartsForMessages(sessionId, messages);
        }
      } catch (e) { getLogger().warn('RESTORE_MESSAGES', e instanceof Error ? e.message : String(e)); }

      enrichSessionMessagesForUi(eng, messages, parts);

      // Include background task status so the UI can show running/completed tasks
      let backgroundTasks: Array<Record<string, unknown>> = [];
      try {
        const subAgentService = getSubAgentServiceInstance();
        const allTasks = subAgentService.getTasksForSession(sessionId);
        backgroundTasks = allTasks.map((t) => ({
          id: t.id,
          status: t.status,
          instruction: t.instruction?.slice(0, 200),
          background: t.background,
          startTime: t.startTime,
          endTime: t.endTime,
          childSessionId: t.childSessionId,
        }));
      } catch { /* best-effort */ }

      // Expose current turn state so the UI can show a "turn active" indicator
      // when returning to a session whose agent is still processing in the
      // background (e.g. after navigating away mid-turn).
      let turnState: {
        phase: string;
        stage?: string;
        step?: number;
        turnId?: string | null;
        startedAt?: number | null;
        partialContent?: string;
        activeParts?: Array<Record<string, unknown>>;
      } | null = null;
      try {
        // Prefer the UI agent, then a bound per-session agent (background turns).
        const agent =
          (eng.agent && eng.agent.sessionId === sessionId ? eng.agent : null)
          ?? eng.boundSessionAgents?.get(sessionId)
          ?? null;
        // Even when the agent was recreated (keepAgent=false because it was
        // processing), mid-turn parts (thoughts, tool calls, responses) are
        // still in the DB with message_id=null. Load them so the UI can
        // rebuild the in-progress assistant bubble instead of showing a bare
        // "executing" indicator with all prior turn content missing.
        let orphanedActiveParts: Array<Record<string, unknown>> = [];
        try {
          const store = eng.sessionManager.getStorageAdapter?.();
          const allParts = store?.getParts?.(sessionId) ?? [];
          orphanedActiveParts = allParts.filter((p) => {
            const mid = p['message_id'] ?? p['messageId'];
            return mid == null || mid === '';
          });
        } catch { /* best-effort */ }
        if (agent) {
          const snap = agent.getTurnStateSnapshot();
          const phase = snap.phase;
          const active = phase !== 'idle' && phase !== 'done' && phase !== 'cancelled';
          // Use the agent's live parts when the turn is active; fall back to
          // orphaned DB parts when the agent was recreated mid-turn.
          const activeParts: Array<Record<string, unknown>> = active ? orphanedActiveParts : [];
          turnState = {
            phase,
            stage: snap.stage,
            step: snap.step,
            turnId: snap.turnId,
            startedAt: snap.startedAt,
            ...(active ? {
              partialContent: agent.getPartialTurnContent?.() ?? '',
              activeParts,
            } : (orphanedActiveParts.length > 0 ? {
              // Agent was recreated but mid-turn parts exist in the DB —
              // surface them so the UI can rebuild the assistant bubble.
              partialContent: '',
              activeParts: orphanedActiveParts,
            } : {})),
          };
        } else if (orphanedActiveParts.length > 0) {
          // No agent at all but parts exist — the turn was interrupted.
          turnState = {
            phase: 'working',
            stage: 'Restoring…',
            step: 0,
            turnId: null,
            startedAt: null,
            partialContent: '',
            activeParts: orphanedActiveParts,
          };
        }
      } catch { /* best-effort */ }

      res.json({
        session,
        messages,
        parts: [],
        crewStates,
        scopePath: session.scopePath,
        interruptedTask,
        turnFeedback: loadTurnFeedbackForSession(eng, sessionId),
        resumeState,
        backgroundTasks,
        turnState,
        messagesMeta: perRole != null ? { total: messageTotal, truncated: messagesTruncated, perRole } : undefined,
      });
    } catch (e: unknown) {
      getLogger().error('RESTORE_SESSION', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'restore-failed' });
    }
  });

  r.get('/api/sessions/:id/feedback', (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (!session) { res.status(404).json({ error: 'not-found' }); return; }
      res.json({ feedback: loadTurnFeedbackForSession(eng, sessionId) });
    } catch (e: unknown) {
      getLogger().error('GET_SESSION_FEEDBACK', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'feedback-load-failed' });
    }
  });

  r.get('/api/sessions/:id/messages', async (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const parsed = sessionMessagesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid-query', details: parsed.error.flatten() });
        return;
      }
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (!session) { res.status(404).json({ error: 'not-found' }); return; }

      const { limit, before } = parsed.data;
      const page = await loadSessionMessagesPage(sessionId, { limit, before });
      let parts: Array<Record<string, unknown>> = [];
      try {
        const store = eng.sessionManager.getStorageAdapter?.();
        parts = await store?.getPartsForMessages?.(sessionId, page.messages) ?? [];
      } catch { /* best-effort */ }
      const enriched = enrichSessionMessagesForUi(eng, [...page.messages], parts);
      const messages = enriched.map((m) => mergeNormalizedMessageForApi(m));
      res.json({ messages, total: page.total, hasMore: page.hasMore });
    } catch (e: unknown) {
      getLogger().error('GET_SESSION_MESSAGES', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'messages-load-failed' });
    }
  });

  r.post('/api/sessions/:id/feedback', validate(turnFeedbackSchema), (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      if (!session) { res.status(404).json({ error: 'not-found' }); return; }

      const { messageId, rating, turnSummary, metadata } = req.body as {
        messageId: string;
        rating: 'positive' | 'negative' | 'skipped';
        turnSummary?: string;
        metadata?: Record<string, unknown>;
      };

      const contextKind = (session.contextKind ?? 'agent_x') as 'agent_x' | 'crew_private';
      const crewId = contextKind === 'crew_private'
        ? ((session as { hostCrewId?: string }).hostCrewId ?? (metadata?.crewId as string | undefined) ?? null)
        : ((metadata?.crewId as string | undefined) ?? null);

      const result = recordTurnFeedback({
        sessionId,
        messageId,
        rating,
        contextKind,
        crewId,
        turnSummary: turnSummary ?? null,
        metadata: metadata ?? null,
      });

      if (!result.ok) {
        res.status(500).json({ error: result.error });
        return;
      }
      res.json({ ok: true, messageId, rating });
    } catch (e: unknown) {
      getLogger().error('POST_SESSION_FEEDBACK', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'feedback-failed' });
    }
  });

  r.post('/api/sessions/:id/context/rebuild', (_req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      const count = agent.rebuildContext();
      agent.rebuildSystemPrompt();
      res.json({ ok: true, rebuilt: count });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS_ID_CONTEXT_REBUILD', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'rebuild-failed' });
    }
  });

  r.post('/api/sessions/:id/context/limits', (req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      const { maxHistoryMessages, maxHistoryChars, maxBlockChars } = req.body as {
        maxHistoryMessages?: number;
        maxHistoryChars?: number;
        maxBlockChars?: number;
      };
      const limits: { maxHistoryMessages?: number; maxHistoryChars?: number; maxBlockChars?: number } = {};
      if (maxHistoryMessages != null) limits.maxHistoryMessages = maxHistoryMessages;
      if (maxHistoryChars != null) limits.maxHistoryChars = maxHistoryChars;
      if (maxBlockChars != null) limits.maxBlockChars = maxBlockChars;
      agent.setContextMemoryLimits(limits);
      res.json({ ok: true, ...limits });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS_ID_CONTEXT_LIMITS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'limits-failed' });
    }
  });

  r.get('/api/sessions/:id/context', async (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const dir = getSessionDir(sessionId);
      const result: Record<string, string> = { context: '', memories: '', pending: '', completed: '', suggestions: '', compaction: '' };
      if (await pathExists(dir)) {
        const files = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
        for (const f of files) {
          const fp = join(dir, f);
          try { result[f.replace('.txt', '')] = await readFile(fp, 'utf-8'); } catch { result[f.replace('.txt', '')] = ''; }
        }
      }
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter?.();
      if (store?.getMessages) {
        const msgs = store.getMessages(sessionId);
        const compactionMsgs = msgs.filter((m) => m.role === 'system' && String(m.content ?? '').includes('[COMPACTION SUMMARY'));
        const compactionText = compactionMsgs.map((m) => String(m.content ?? '').trim()).filter(Boolean).join('\n\n---\n\n');
        if (compactionText) result['compaction'] = compactionText;

        if (!result['context']) {
          const conversation = msgs
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => `[${m.role}]\n${m.content ?? ''}`)
            .join('\n\n');
          result['context'] = conversation;
        }
      }
      res.json(result);
    } catch (e) {
      getLogger().error('GET_API_SESSIONS_ID_CONTEXT', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'context-read-failed' });
    }
  });

  r.post('/api/sessions/:id/context/write', async (req, res) => {
    try {
      const dir = await ensureSessionDir(req.params['id']!);
      const updates = req.body as Record<string, string>;
      for (const [key, content] of Object.entries(updates)) {
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '');
        if (['context', 'memories', 'pending', 'completed', 'suggestions'].includes(safeKey)) {
          await atomicWriteFileSync(join(dir, `${safeKey}.txt`), content);
        }
      }
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_SESSIONS_ID_CONTEXT_WRITE', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'context-write-failed' });
    }
  });

  r.post('/api/sessions/:id/compact', async (req, res) => {
    try {
      const dir = getSessionDir(req.params['id']!);
      if (!(await pathExists(dir))) { res.status(404).json({ error: 'session-dir-not-found' }); return; }
      const contextPath = join(dir, 'context.txt');
      const existingContent = (await pathExists(contextPath)) ? await readFile(contextPath, 'utf-8') : '';
      let summary = '';
      if (existingContent.length > 100) {
        try {
          const eng = getEngine();
          const cfg = eng.configManager.load();
          const providerId = cfg.provider.activeProvider;
          const providerCfg = cfg.provider.providers[providerId];
          if (providerCfg?.configured && providerCfg?.apiKey) {
            const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
            const prompt = `Summarize the following conversation into a concise condensed version preserving all key decisions, code changes, and user intent. Keep the summary under 2000 characters:\n\n${existingContent.slice(-5000)}`;
            const request: CompletionRequest = {
              model: cfg.provider.activeModel,
              messages: [
                { role: 'system', content: 'You are a conversation summarizer. Produce concise summaries preserving key facts, decisions, and intent.' },
                { role: 'user', content: prompt },
              ],
              stream: false,
            };
            let fullText = '';
            for await (const chunk of provider.complete(request)) {
              if (chunk.type === 'text_delta' && chunk.content) {
                fullText += chunk.content;
              }
              if (chunk.type === 'done') break;
            }
            summary = fullText || '[summariser returned empty response]';
          } else {
            summary = `[provider ${providerId} not fully configured]`;
          }
        } catch (e) {
          summary = `[automatic compaction unavailable — content was ${existingContent.length} chars]`;
        }
      }
      const compacted = `[session compacted at ${new Date().toISOString()}]\n\n${summary || `Original content (${existingContent.length} chars) preserved.`}`;
      await atomicWriteFileSync(contextPath, compacted);

      // Archive original to conversation.json
      const convPath = join(dir, 'conversation.json');
      try {
        const existing = JSON.parse(await readFile(convPath, 'utf-8') || '[]') as Array<Record<string, unknown>>;
        existing.push({ timestamp: new Date().toISOString(), type: 'compaction', snapshot: existingContent });
        await atomicWriteFileSync(convPath, JSON.stringify(existing, null, 2));
      } catch (e) { /* ignore */ }

      res.json({ ok: true, summary });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS_ID_COMPACT', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'compact-failed' });
    }
  });

  r.post('/api/sessions/:id/checkpoint', validate(createCheckpointSchema), (req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter?.();
      if (!store?.createCheckpoint) { res.status(500).json({ error: 'store-unavailable' }); return; }
      const label = (req.body as Record<string, string>)['label'] || new Date().toLocaleTimeString();
      const result = store.createCheckpoint(req.params['id']!, label);
      if (!result) { res.status(400).json({ error: 'no-messages' }); return; }
      res.json({ checkpointId: result.id, label });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS_ID_CHECKPOINT', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'checkpoint-failed' });
    }
  });

  r.get('/api/sessions/:id/checkpoints', (req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter?.();
      if (!store?.listCheckpoints) { res.json({ checkpoints: [] }); return; }
      const checkpoints = store.listCheckpoints(req.params['id']!);
      res.json({ checkpoints });
    } catch (e: unknown) {
      getLogger().error('GET_API_SESSIONS_ID_CHECKPOINTS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
    }
  });

  r.post('/api/sessions/:id/checkpoint/:checkpointId/restore', (req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter?.();
      if (!store?.restoreCheckpoint) { res.status(500).json({ error: 'store-unavailable' }); return; }
      const ok = store.restoreCheckpoint(req.params['id']!, req.params['checkpointId']!);
      if (!ok) { res.status(404).json({ error: 'checkpoint-not-found' }); return; }
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS_ID_CHECKPOINT_CHECKPOINTID_RESTO', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'restore-failed' });
    }
  });

  r.delete('/api/sessions/:id/checkpoint/:checkpointId', (req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter?.();
      if (!store?.deleteCheckpoint) { res.status(500).json({ error: 'store-unavailable' }); return; }
      const ok = store.deleteCheckpoint(req.params['id']!, req.params['checkpointId']!);
      if (!ok) { res.status(404).json({ error: 'checkpoint-not-found' }); return; }
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('DELETE_API_SESSIONS_ID_CHECKPOINT_CHECKPOINTID', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
    }
  });

  r.get('/api/sessions/:sessionId/permissions', (req, res) => {
    try {
      const sessionId = req.params['sessionId']!;
      const agent = resolveSessionAgent(sessionId);
      if (!agent) { res.status(404).json({ error: 'not-found' }); return; }
      const pm = agent.getToolExecutor()?.getPermissionManager();
      const decisions = (pm?.list() ?? [])
        .filter((p) => p.toolName !== '*')
        .map((p) => ({ toolName: p.toolName, targetPath: p.targetPath, decision: p.decision }));
      res.json({ bypassPermissions: agent.bypassPermissions, decisions });
    } catch (e: unknown) {
      getLogger().error('GET_API_SESSIONS_PERMISSIONS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'permissions-load-failed' });
    }
  });

  r.post('/api/sessions/:sessionId/permissions/bypass', (req, res) => {
    try {
      const sessionId = req.params['sessionId']!;
      const { enabled } = req.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled boolean required' }); return; }
      const agent = resolveSessionAgent(sessionId);
      if (!agent) { res.status(404).json({ error: 'not-found' }); return; }
      agent.setBypassPermissions(enabled);
      res.json({ bypassPermissions: agent.bypassPermissions });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS_PERMISSIONS_BYPASS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'bypass-update-failed' });
    }
  });

  r.post('/api/sessions/:sessionId/permissions/revoke', (req, res) => {
    try {
      const sessionId = req.params['sessionId']!;
      const agent = resolveSessionAgent(sessionId);
      if (!agent) { res.status(404).json({ error: 'not-found' }); return; }
      agent.revokeSessionPermissions();
      res.json({ bypassPermissions: agent.bypassPermissions, ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS_PERMISSIONS_REVOKE', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'revoke-failed' });
    }
  });

  r.post('/api/sessions/:sessionId/permissions/tool', (req, res) => {
    try {
      const sessionId = req.params['sessionId']!;
      const body = req.body as { toolName?: unknown; decision?: unknown };
      if (typeof body.toolName !== 'string' || !body.toolName) {
        res.status(400).json({ error: 'toolName is required' }); return;
      }
      const decision = String(body.decision);
      if (!['allow_always', 'deny', 'revoke'].includes(decision)) {
        res.status(400).json({ error: "decision must be 'allow_always', 'deny', or 'revoke'" }); return;
      }
      const agent = resolveSessionAgent(sessionId);
      if (!agent) { res.status(404).json({ error: 'not-found' }); return; }
      if (decision === 'revoke') {
        const pm = agent.getToolExecutor()?.getPermissionManager();
        if (pm) pm.revoke(body.toolName);
      } else {
        agent.recordToolPermissionDecision(body.toolName, decision as 'allow_always' | 'deny');
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_SESSIONS_PERMISSIONS_TOOL', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'tool-permission-failed' });
    }
  });

  r.delete('/api/sessions', (_req, res) => {
    try {
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter?.();
      store.clearAll();
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('DELETE_API_SESSIONS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'clear-failed' });
    }
  });


  return r;
}
