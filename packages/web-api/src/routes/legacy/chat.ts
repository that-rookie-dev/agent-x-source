/**
 * Chat route group (message streaming, queue, steer, history, clear).
 *
 * Extracted from legacy.ts. Registers handlers on a dedicated Router and
 * exports createChatRouter() for mounting by the legacy aggregator.
 */
import { Router } from 'express';
import { getLogger, normalizeClientSituation, sanitizeForJson } from '@agentx/shared';
import type { TurnAttachment } from '@agentx/shared';
import { getEngine, getOrCreateAgent, setCurrentClientSituation } from '../../engine.js';
import {
  runAgentTurnAsync,
  cancelActiveSessionTurn,
  getForceWebSearchError,
  isCrewPrivateSessionRecord,
  buildTurnInstruction,
  ensureSessionHydratedForTurn,
} from '../../chat-helpers.js';
import { validate, chatMessageSchema, chatSteerSchema } from '../../validation.js';
import { ensureSubscribed, persistMessageDirect } from '../../ws.js';
import { turnRegistry } from '../../turn-registry.js';
import { maybeAugmentChatInstruction, handleChannelHandoffRequest } from '../../channel-session-bridge.js';
import { waitForIdle } from './shared.js';
import { messageQueue } from './shared.js';
import { assertChatWorkspaceAttachments } from '../../workspace.js';

function rejectUnsafeWorkspaceAttachments(
  res: import('express').Response,
  attachments: TurnAttachment[] | undefined,
): TurnAttachment[] | null {
  const checked = assertChatWorkspaceAttachments(attachments);
  if (!checked.ok) {
    res.status(422).json({
      status: 'error',
      code: 'WORKSPACE_ATTACHMENT_DENIED',
      error: checked.error,
      details: checked.details,
    });
    return null;
  }
  return checked.attachments;
}

export function createChatRouter(): Router {
  const r = Router();

  r.post('/api/chat/message-stream', validate(chatMessageSchema), async (req, res) => {
    try {
      const { text, attachments: rawAttachments, retry, delegateCrewIds, crewSuggestionResolved, priorUserMessages, crewIntakeFromPicker, primaryCrewId, forceWebSearch, userMessagePersisted, crewSuggestionRequested, todoDisposition, clientSituation: clientSituationRaw } = req.body as {
        text: string;
        attachments?: TurnAttachment[];
        retry?: boolean;
        delegateCrewIds?: string[];
        crewSuggestionResolved?: boolean;
        priorUserMessages?: string[];
        crewIntakeFromPicker?: boolean;
        primaryCrewId?: string;
        forceWebSearch?: boolean;
        userMessagePersisted?: boolean;
        crewSuggestionRequested?: boolean;
        todoDisposition?: 'continue' | 'skip' | 'defer';
        clientSituation?: unknown;
      };
      const attachments = rejectUnsafeWorkspaceAttachments(res, rawAttachments);
      if (attachments === null) return;
      const clientSituation = normalizeClientSituation(clientSituationRaw);
      const eng = getEngine();
      if (clientSituation) {
        // Keep the engine's source-of-truth location in sync for channel agents.
        setCurrentClientSituation(clientSituation);
      }

      // Auto-create agent if none exists
      if (!eng.agent) {
        getOrCreateAgent();
      }
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      ensureSubscribed();

      // ─── Safety: reset stuck agent ───
      if (agent.processing) {
        try { agent.cancel(); } catch (e) { /* ignore */ }
        await new Promise(r => setTimeout(r, 250));
        if (agent.processing) {
          res.status(503).json({ error: 'Agent is busy. Please try again in a moment.' });
          return;
        }
      }

      // Setup SSE response headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let eventId = 0;
      const sendEvent = (event: string, data: unknown) => {
        try {
          res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          eventId++;
        } catch (e) { /* connection closed */ }
      };

      // Send initial "connected" event
      sendEvent('connected', { timestamp: new Date().toISOString() });

      // Apply session mode from active session record
      // ─── Retry: remove only the assistant reply being regenerated (keep user turn in DB) ───
      if (retry) {
        try {
          const store = eng.sessionManager.getStorageAdapter();
          if (store?.deleteLastMessages) {
            const sid = agent.sessionId;
            if (sid) store.deleteLastMessages(sid, 1, ['assistant']);
          }
        } catch (e) { /* best-effort */ }
      }

      const fullText = sanitizeForJson(text ?? '');
      const activeSess = eng.sessionManager.getActiveSession?.();
      const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
      const sid = agent.sessionId;

      // Ensure the session cache is hydrated before any message/tool persistence happens.
      if (sid) {
        const store = eng.sessionManager.getStorageAdapter?.();
        await ensureSessionHydratedForTurn(store, sid);
      }

      if (sid) {
        const handoff = await handleChannelHandoffRequest({ eng, sessionId: sid, text: fullText });
        if (handoff.handled && handoff.reply) {
          persistMessageDirect(sid, 'user', fullText);
          persistMessageDirect(sid, 'assistant', handoff.reply);
          sendEvent('complete', { ok: true, message: { role: 'assistant', content: handoff.reply, id: `msg_${Date.now()}` } });
          res.end();
          return;
        }
      }

      const instruction = buildTurnInstruction({ crewPrivate: crewPrivateChat });
      const augmentedInstruction = sid
        ? maybeAugmentChatInstruction(eng, sid, fullText, instruction)
        : instruction;

      // Auto-checkpoint
      try {
        const store = eng.sessionManager.getStorageAdapter();
        if (store?.createCheckpoint) {
          if (sid) {
            const label = `Auto · ${new Date().toLocaleTimeString()}`;
            store.createCheckpoint(sid, label);
          }
        }
      } catch (e) { /* best-effort */ }

      const unsub = eng.telemetry.onEvent((ev) => {
        sendEvent('progress', ev);
      });

      const heartbeat = setInterval(() => {
        try {
          res.write(':heartbeat\n\n');
        } catch {
          clearInterval(heartbeat);
          unsub();
        }
      }, 25000);

      // Crew suggestion gate is now opt-in via the crewSuggestionRequested toggle
      // (FIX-4.7). The server no longer auto-blocks the turn; the agent receives
      // a roster hint instruction when the user explicitly requests suggestions.

      const forceErr = getForceWebSearchError(eng.configManager.load(), forceWebSearch);
      if (forceErr) {
        sendEvent('error', { error: forceErr, code: 'WEB_SEARCH_UNAVAILABLE' });
        clearInterval(heartbeat);
        unsub();
        res.end();
        return;
      }

      const turn = turnRegistry.create(sid);
      let finished = false;

      const finishTurn = (record: ReturnType<typeof turnRegistry.get>) => {
        if (finished || !record) return;
        if (record.status === 'complete') {
          finished = true;
          if ((record.message as Record<string, unknown> | undefined)?.id === '__clarify__') {
            sendEvent('clarification', { ok: true });
          } else {
            sendEvent('complete', { ok: true, message: record.message, turnId: turn.turnId });
          }
          clearInterval(heartbeat);
          unsubTurn();
          unsub();
          res.end();
        } else if (record.status === 'error' || record.status === 'cancelled') {
          finished = true;
          sendEvent('error', { error: record.error ?? 'chat-failed', code: 'PROCESSING_FAILED', partialContent: record.partialContent });
          clearInterval(heartbeat);
          unsubTurn();
          unsub();
          res.end();
        }
      };

      const unsubTurn = turnRegistry.subscribe(turn.turnId, finishTurn);

      req.on('close', () => {
        // Client disconnected (e.g. navigated away from chat page).
        // We intentionally do NOT cancel the agent here so that turns continue
        // running in the background. The turn registry tracks completion and
        // the UI re-syncs via /api/sessions/:id/restore + /api/agent/turn-state
        // when the user returns to the chat.
        finished = true;
        unsubTurn();
        clearInterval(heartbeat);
        unsub();
      });

      runAgentTurnAsync(agent, fullText, augmentedInstruction, retry, turn.turnId, sid, undefined, undefined, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, {
        ...(forceWebSearch ? { forceWebSearch: true } : {}),
        ...(userMessagePersisted ? { userMessagePersisted: true } : {}),
        ...(clientSituation ? { clientSituation } : {}),
        ...(crewSuggestionRequested ? { crewSuggestionRequested: true } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(todoDisposition ? { todoDisposition } : {}),
      });
      sendEvent('started', { turnId: turn.turnId, async: true });
      return;
    } catch (e: unknown) {
      getLogger().error('CHAT_MESSAGE_STREAM_SETUP', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'stream-setup-failed' });
    }
  });

  r.post('/api/chat/message', validate(chatMessageSchema), async (req, res) => {
    try {
      const { text, attachments: rawAttachments, retry, delegateCrewIds, crewSuggestionResolved, priorUserMessages, crewIntakeFromPicker, primaryCrewId, forceWebSearch, userMessagePersisted, crewSuggestionRequested, todoDisposition, clientSituation: clientSituationRaw } = req.body as {
        text: string;
        attachments?: TurnAttachment[];
        retry?: boolean;
        delegateCrewIds?: string[];
        crewSuggestionResolved?: boolean;
        priorUserMessages?: string[];
        crewIntakeFromPicker?: boolean;
        primaryCrewId?: string;
        forceWebSearch?: boolean;
        userMessagePersisted?: boolean;
        crewSuggestionRequested?: boolean;
        todoDisposition?: 'continue' | 'skip' | 'defer';
        clientSituation?: unknown;
      };
      const attachments = rejectUnsafeWorkspaceAttachments(res, rawAttachments);
      if (attachments === null) return;
      const clientSituation = normalizeClientSituation(clientSituationRaw);
      if (clientSituation) setCurrentClientSituation(clientSituation);
      const eng = getEngine();
      // Auto-create agent if none exists (first message in session)
      if (!eng.agent) {
        getOrCreateAgent();
      }
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      ensureSubscribed();

      // ─── Safety: reset stuck agent if processing flag leaked from previous call ───
      if (agent.processing) {
        try { agent.cancel(); } catch (e) { /* ignore */ }
        await new Promise(r => setTimeout(r, 250));
        if (agent.processing) {
          res.status(503).json({ error: 'Agent is busy. Please try again in a moment.' });
          return;
        }
      }

      // ─── Retry: remove only the assistant reply being regenerated (keep user turn in DB) ───
      if (retry) {
        try {
          const store = eng.sessionManager.getStorageAdapter();
          if (store?.deleteLastMessages) {
            const sid = agent.sessionId;
            if (sid) store.deleteLastMessages(sid, 1, ['assistant']);
          }
        } catch (e) { /* best-effort */ }
      }

      const fullText = sanitizeForJson(text ?? '');
      const activeSess = eng.sessionManager.getActiveSession?.();
      const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
      const sid = agent.sessionId;

      // Ensure the session cache is hydrated before any message/tool persistence happens.
      if (sid) {
        const store = eng.sessionManager.getStorageAdapter?.();
        await ensureSessionHydratedForTurn(store, sid);
      }

      if (sid) {
        const handoff = await handleChannelHandoffRequest({ eng, sessionId: sid, text: fullText });
        if (handoff.handled && handoff.reply) {
          persistMessageDirect(sid, 'user', fullText);
          persistMessageDirect(sid, 'assistant', handoff.reply);
          res.status(200).json({ ok: true, message: { role: 'assistant', content: handoff.reply, id: `msg_${Date.now()}` } });
          return;
        }
      }

      const instruction = buildTurnInstruction({ crewPrivate: crewPrivateChat });
      const augmentedInstruction = sid
        ? maybeAugmentChatInstruction(eng, sid, fullText, instruction)
        : instruction;

      // Auto-checkpoint before each user turn — enables /undo to roll back this turn
      try {
        const store = eng.sessionManager.getStorageAdapter();
        if (store?.createCheckpoint) {
          if (sid) {
            const label = `Auto · ${new Date().toLocaleTimeString()}`;
            store.createCheckpoint(sid, label);
          }
        }
      } catch (e) { /* checkpoint failure shouldn't block the message */ }

      // Crew suggestion gate is now opt-in via the crewSuggestionRequested toggle
      // (FIX-4.7). The server no longer auto-blocks the turn; the agent receives
      // a roster hint instruction when the user explicitly requests suggestions.

      const forceErr = getForceWebSearchError(eng.configManager.load(), forceWebSearch);
      if (forceErr) {
        res.status(400).json({ error: forceErr });
        return;
      }

      const turn = turnRegistry.create(sid);
      runAgentTurnAsync(agent, fullText, augmentedInstruction, retry, turn.turnId, sid, undefined, undefined, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, {
        ...(forceWebSearch ? { forceWebSearch: true } : {}),
        ...(userMessagePersisted ? { userMessagePersisted: true } : {}),
        ...(clientSituation ? { clientSituation } : {}),
        ...(crewSuggestionRequested ? { crewSuggestionRequested: true } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(todoDisposition ? { todoDisposition } : {}),
      });

      res.status(202).json({ ok: true, turnId: turn.turnId, async: true, status: 'running' });
    } catch (e: unknown) {
      getLogger().error('CHAT_MESSAGE', e instanceof Error ? e : String(e));
      try {
        const eng = getEngine();
        const agent = eng.agent;
        if (agent) {
          const sid = agent.sessionId;
          if (sid) {
            persistMessageDirect(sid, 'user', (req.body as { text?: string }).text || '');
          }
        }
      } catch (e) { /* best-effort */ }
      res.status(500).json({ error: e instanceof Error ? e.message : 'chat-failed' });
    }
  });

  r.post('/api/chat/cancel', (_req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      const sid = (eng.sessionManager.getActiveSession?.() as { id?: string } | null | undefined)?.id;
      if (sid) cancelActiveSessionTurn(sid);
      agent.cancel();
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_CHAT_CANCEL', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'cancel-failed' });
    }
  });

  r.post('/api/chat/queue', validate(chatMessageSchema), (req, res) => {
    try {
      const { text, attachments: rawAttachments, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId } = req.body as {
        text: string;
        attachments?: TurnAttachment[];
        delegateCrewIds?: string[];
        crewSuggestionResolved?: boolean;
        crewIntakeFromPicker?: boolean;
        primaryCrewId?: string;
      };
      const attachments = rejectUnsafeWorkspaceAttachments(res, rawAttachments);
      if (attachments === null) return;
      messageQueue.push({ text, attachments, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId });
      res.json({ ok: true, queueLength: messageQueue.length });
    } catch (e) {
      getLogger().error('POST_API_CHAT_QUEUE', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'queue-failed' });
    }
  });

  r.get('/api/chat/queue', (_req, res) => {
    res.json({ queue: messageQueue, length: messageQueue.length });
  });

  r.delete('/api/chat/queue', (_req, res) => {
    messageQueue.length = 0;
    res.json({ ok: true });
  });

  r.post('/api/chat/steer', validate(chatSteerSchema), async (req, res) => {
    try {
      const { text, attachments: rawAttachments, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, clientSituation: clientSituationRaw } = req.body as {
        text: string;
        attachments?: TurnAttachment[];
        delegateCrewIds?: string[];
        crewSuggestionResolved?: boolean;
        crewIntakeFromPicker?: boolean;
        primaryCrewId?: string;
        clientSituation?: unknown;
      };
      const attachments = rejectUnsafeWorkspaceAttachments(res, rawAttachments);
      if (attachments === null) return;
      const clientSituation = normalizeClientSituation(clientSituationRaw);
      if (clientSituation) setCurrentClientSituation(clientSituation);
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      agent.cancel();
      await waitForIdle(agent);
      ensureSubscribed();
      const fullText = sanitizeForJson(text ?? '');
      const activeSess = eng.sessionManager.getActiveSession?.();
      const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
      const instruction = buildTurnInstruction({ crewPrivate: crewPrivateChat });
      const sid = agent.sessionId;
      const turn = turnRegistry.create(sid);
      runAgentTurnAsync(agent, fullText, instruction, false, turn.turnId, sid, undefined, undefined, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, {
        ...(clientSituation ? { clientSituation } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      res.status(202).json({ ok: true, turnId: turn.turnId, async: true, status: 'running' });
    } catch (e: unknown) {
      getLogger().error('POST_API_CHAT_STEER', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'steer-failed' });
    }
  });

  r.post('/api/chat/checkpoint-respond', async (req, res) => {
    try {
      const { checkpointId, action } = req.body as { checkpointId: string; action: string };
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      const resolved = agent.resolveCheckpoint(checkpointId, action);
      if (!resolved) {
        res.status(404).json({ error: 'checkpoint-not-found' });
        return;
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('CHECKPOINT_RESPOND', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'checkpoint-respond-failed' });
    }
  });

  r.post('/api/chat/stop-and-send', validate(chatSteerSchema), async (req, res) => {
    try {
      const { text, attachments: rawAttachments, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, clientSituation: clientSituationRaw } = req.body as {
        text: string;
        attachments?: TurnAttachment[];
        delegateCrewIds?: string[];
        crewSuggestionResolved?: boolean;
        crewIntakeFromPicker?: boolean;
        primaryCrewId?: string;
        clientSituation?: unknown;
      };
      const attachments = rejectUnsafeWorkspaceAttachments(res, rawAttachments);
      if (attachments === null) return;
      const clientSituation = normalizeClientSituation(clientSituationRaw);
      if (clientSituation) setCurrentClientSituation(clientSituation);
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      agent.cancel();
      await waitForIdle(agent);
      ensureSubscribed();
      const fullText = sanitizeForJson(text ?? '');
      const activeSess = eng.sessionManager.getActiveSession?.();
      const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
      const instruction = buildTurnInstruction({ crewPrivate: crewPrivateChat });
      const sid = agent.sessionId;
      const turn = turnRegistry.create(sid);
      runAgentTurnAsync(agent, fullText, instruction, false, turn.turnId, sid, undefined, undefined, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, {
        ...(clientSituation ? { clientSituation } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      res.status(202).json({ ok: true, turnId: turn.turnId, async: true, status: 'running' });
    } catch (e: unknown) {
      getLogger().error('POST_API_CHAT_STOP_AND_SEND', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'stop-and-send-failed' });
    }
  });

  r.get('/api/chat/history', (_req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.json([]); return; }
      const history = agent.getMessageHistory();
      // Ensure each message has an id for the UI (CompletionMessage doesn't guarantee id)
      const formatted = history.map((m, i) => ({
        id: (m as { id?: string }).id || `hist-${i}`,
        role: m.role,
        content: m.content || '',
        tokenCount: Math.ceil((m.content?.length ?? 0) / 4),
      }));
      res.json(formatted);
    } catch (e) {
      res.json([]);
    }
  });

  r.post('/api/chat/clear', (_req, res) => {
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
      agent.clearHistory();
      res.json({ ok: true });
    } catch (e) {
      getLogger().error('POST_API_CHAT_CLEAR', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'clear-failed' });
    }
  });

  r.get('/api/chat/stream', (req, res) => {
    const eng = getEngine();
    let eventId = 0;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Tell the client to retry connection after 3 seconds on drop
    res.write('retry: 3000\n\n');

    const sendEvent = (event: string, data: unknown) => {
      try {
        res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        eventId++;
      } catch (e) { /* connection closed */ }
    };

    sendEvent('connected', { timestamp: new Date().toISOString() });

    // Subscribe to telemetry bus ONLY — agent events are already bridged to telemetry
    // in createAgent(). Subscribing to both would cause duplicate events.
    const unsub = eng.telemetry.onEvent((ev) => {
      sendEvent('telemetry', ev);
    });

    // Heartbeat to detect dead connections (every 25s)
    const heartbeat = setInterval(() => {
      sendEvent('ping', { ts: Date.now() });
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
      res.end();
    });
  });


  return r;
}
