/**
 * Crews route group (crew CRUD, suggestions, roster picker, catalog, feedback).
 *
 * Extracted from legacy.ts. Registers handlers on a dedicated Router and
 * exports createCrewsRouter() for mounting by the legacy aggregator.
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { Agent } from '@agentx/engine';
import {
  validate,
  crewSuggestionEvaluateSchema,
  crewSuggestionResolveSchema,
  crewRosterPickerOfferSchema,
  crewRosterPickerUpdateSchema,
  crewChatSessionSchema,
  crewChatVoiceSessionSchema,
} from '../../validation.js';
import {
  postCrewSuggestionEvaluate,
  postCrewSuggestionResolve,
  postCrewSuggestionClearDismiss,
  getCatalogEntry,
  getCatalogSeedStatusHandler,
  listCatalogCategories,
  listCatalogByCategory,
  searchCatalogEntries,
} from '../../crew-suggestions.js';
import { persistCrewRosterPickerOffer, updateCrewRosterPickerStatus } from '../../crew-roster-picker-api.js';
import {
  postCrewChatSession,
  postCrewChatVoiceSession,
  listCrewChatVoiceSessions,
  deleteCrewChatVoiceSession,
} from '../../crew-chat.js';
import { postAgentXCoreSession } from '../../agent-x-core.js';

export function createCrewsRouter(): Router {
  const r = Router();

  r.get('/api/crews', (_req, res) => {
    const eng = getEngine();
    const crews = eng.crewManager.list().map((c) => ({ ...c, tone: c.emotion }));
    res.json({ crews });
  });

  r.post('/api/crew/toggle', (req, res) => {
    try {
      const { crewId, enabled } = req.body as { crewId: string; enabled: boolean };
      const eng = getEngine();
      
      // Update crew in CrewManager
      if (enabled) {
        eng.crewManager.enable(crewId);
      } else {
        eng.crewManager.disable(crewId);
      }
      
      // Update agent
      if (eng.agent) {
        eng.agent.setCrewEnabled(crewId, enabled);
      }
      
      // Save to session store
      if (eng.sessionManager) {
        eng.sessionManager.saveCrewState(crewId, enabled);
      }
      
      res.json({ ok: true, crewId, enabled });
    } catch (e: unknown) {
      getLogger().error('POST_API_CREW_TOGGLE', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'toggle-failed' });
    }
  });

  r.post('/api/crews', async (req, res) => {
    try {
      const body = req.body as {
        id: string; name: string; title?: string; callsign?: string; systemPrompt: string; description?: string;
        emotion?: string; tone?: string; isDefault?: boolean; expertise?: string[]; traits?: string[]; tools?: string[];
        color?: string; icon?: string; source?: string; catalogId?: string;
      };
      const emotion = body.emotion ?? body.tone;
      const { id, name, title, callsign, systemPrompt, description, isDefault, expertise, traits, tools, color, icon, source, catalogId } = body;
      const eng = getEngine();
      const crew = eng.crewManager.create({
        id: id || crypto.randomUUID(),
        name,
        title,
        callsign: callsign || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        systemPrompt,
        description,
        emotion: emotion as 'professional' | 'friendly' | 'witty' | 'kind' | 'funny' | 'arrogant' | 'flirty' | 'happy' | 'sad' | 'sarcastic' | undefined,
        isDefault,
        expertise,
        traits,
        tools,
        color,
        icon,
        source: (source as 'custom' | 'hub' | undefined) ?? (catalogId ? 'hub' : 'custom'),
        catalogId,
      });
      await eng.crewManager.flushPersist();
      if (eng.agent && crew.enabled) {
        eng.agent.addCrewMember(crew);
        eng.agent.setCrewEnabled(crew.id, true);
      }
      res.json(crew);
    } catch (e: unknown) {
      getLogger().error('POST_API_CREWS', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'create-failed' });
    }
  });

  r.put('/api/crews/:id', async (req, res) => {
    try {
      const eng = getEngine();
      const body = req.body as Record<string, unknown>;
      const updates = {
        ...body,
        emotion: (body['emotion'] ?? body['tone']) as string | undefined,
      };
      delete (updates as Record<string, unknown>)['tone'];
      const crew = eng.crewManager.update(req.params['id']!, updates as Parameters<typeof eng.crewManager.update>[1]);
      if (!crew) { res.status(404).json({ error: 'crew-not-found' }); return; }
      await eng.crewManager.flushPersist();
      if (eng.agent) {
        eng.agent.removeCrewMember(crew.id);
        if (crew.enabled) {
          eng.agent.addCrewMember(crew);
          eng.agent.setCrewEnabled(crew.id, true);
        } else {
          eng.agent.setCrewEnabled(crew.id, false);
        }
      }
      res.json(crew);
    } catch (e: unknown) {
      getLogger().error('PUT_API_CREWS_ID', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'update-failed' });
    }
  });

  r.delete('/api/crews/:id', async (req, res) => {
    try {
      const eng = getEngine();
      const ok = eng.crewManager.delete(req.params['id']!);
      if (!ok) { res.status(400).json({ error: 'cannot-delete' }); return; }
      await eng.crewManager.flushPersist();
      if (eng.agent) {
        eng.agent.removeCrewMember(req.params['id']!);
        eng.agent.setCrewEnabled(req.params['id']!, false);
      }
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('DELETE_API_CREWS_ID', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'delete-failed' });
    }
  });

  r.post('/api/crew-suggestions/evaluate', validate(crewSuggestionEvaluateSchema), postCrewSuggestionEvaluate);

  r.post('/api/crew-suggestions/resolve', validate(crewSuggestionResolveSchema), postCrewSuggestionResolve);

  r.post('/api/crew-suggestions/clear-dismiss', postCrewSuggestionClearDismiss);

  r.post('/api/sessions/:id/crew-roster-picker', validate(crewRosterPickerOfferSchema), (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const { userText, evaluation, attachments, userMessageId } = req.body as {
        userText: string;
        evaluation: import('@agentx/shared').CrewSuggestionEvaluation;
        attachments?: Array<{ name: string }>;
        userMessageId?: string;
      };
      const eng = getEngine();
      if (!eng.sessionManager.getSessionById(sessionId)) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      const ids = persistCrewRosterPickerOffer({ sessionId, userText, evaluation, attachments, userMessageId });
      res.json({ ok: true, ...ids });
    } catch (e: unknown) {
      getLogger().error('CREW_ROSTER_PICKER_OFFER', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'offer-failed' });
    }
  });

  r.patch('/api/sessions/:id/crew-roster-picker', validate(crewRosterPickerUpdateSchema), (req, res) => {
    try {
      const sessionId = req.params['id']!;
      const body = req.body as {
        pickerMessageId: string;
        status: 'answered' | 'skipped';
        selectedCandidateIds?: string[];
        evaluation: import('@agentx/shared').CrewSuggestionEvaluation;
        pendingUserText: string;
        pickerPartId?: string;
      };
      updateCrewRosterPickerStatus({
        sessionId,
        pickerMessageId: body.pickerMessageId,
        status: body.status,
        selectedCandidateIds: body.selectedCandidateIds,
        evaluation: body.evaluation,
        pendingUserText: body.pendingUserText,
        pickerPartId: body.pickerPartId,
      });
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('CREW_ROSTER_PICKER_UPDATE', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'update-failed' });
    }
  });

  r.post('/api/crew-chat/sessions', validate(crewChatSessionSchema), postCrewChatSession);
  r.get('/api/crew-chat/voice-sessions', listCrewChatVoiceSessions);
  r.post('/api/crew-chat/voice-sessions', validate(crewChatVoiceSessionSchema), postCrewChatVoiceSession);
  r.delete('/api/crew-chat/voice-sessions/:id', deleteCrewChatVoiceSession);

  r.post('/api/agent-x-core/session', postAgentXCoreSession);

  r.get('/api/crew-catalog/categories', listCatalogCategories);

  r.get('/api/crew-catalog/seed-status', getCatalogSeedStatusHandler);

  r.get('/api/crew-catalog/search', searchCatalogEntries);

  r.get('/api/crew-catalog/by-category/:categoryId', listCatalogByCategory);

  r.get('/api/crew-catalog/:id', getCatalogEntry);

  r.get('/api/crew/:id', (_req, res) => {
    const eng = getEngine();
    const crew = eng.crewManager.list().find(c => c.id === _req.params.id);
    if (!crew) return res.status(404).json({ error: 'Crew not found' });
    res.json(crew);
  });

  r.post('/api/crew/:id/feedback', (req, res) => {
    try {
      const eng = getEngine();
      const crewId = req.params['id']!;
      const { positive, comment } = req.body as { positive: boolean; comment?: string };
      if (typeof positive !== 'boolean') { res.status(400).json({ error: 'positive must be a boolean' }); return; }
      const store = eng.sessionManager.getStorageAdapter();
      const sessionId = eng.agent?.sessionId ?? 'unknown';
      if (store?.addCrewFeedback) {
        store.addCrewFeedback({
          id: crypto.randomUUID(),
          sessionId,
          crewId,
          positive,
          comment: comment ?? null,
          createdAt: new Date().toISOString(),
        });
        const agentInst = eng.agent as Agent & { recordCrewFeedback?: (crewId: string, positive: boolean) => void } | null;
        agentInst?.recordCrewFeedback?.(crewId, positive);
        res.json({ ok: true });
      } else {
        res.status(500).json({ error: 'store-unavailable' });
      }
    } catch (e: unknown) {
      getLogger().error('POST_API_CREW_ID_FEEDBACK', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'feedback-failed' });
    }
  });

  r.get('/api/crew/:id/feedback', (req, res) => {
    try {
      const eng = getEngine();
      const crewId = req.params['id']!;
      const store = eng.sessionManager.getStorageAdapter();
      const feedback = store?.getCrewFeedback?.(crewId) ?? [];
      res.json({ feedback });
    } catch (e: unknown) {
      getLogger().error('GET_API_CREW_ID_FEEDBACK', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'feedback-load-failed' });
    }
  });

  r.post('/api/crew/generate-metadata', async (req, res) => {
    try {
      const { systemPrompt, title, name, description } = req.body as { systemPrompt?: string; title?: string; name?: string; description?: string };

      const eng = getEngine();
      const cfg = eng.configManager.load();
      const providerId = cfg.provider.activeProvider;
      if (!providerId) { res.json({ expertise: [], traits: [], revisedPrompt: '' }); return; }
      const providerCfg = cfg.provider.providers[providerId];
      const apiKey = providerCfg?.apiKey || providerCfg?.profiles?.[providerCfg?.activeProfile ?? '']?.apiKey;

      if (!apiKey) { res.json({ expertise: [], traits: [], revisedPrompt: '' }); return; }

      const { ProviderFactory } = await import('@agentx/engine');
      const provider = ProviderFactory.create(providerId, apiKey, providerCfg?.baseUrl);

      const genPrompt = systemPrompt
        ? `Analyze this AI crew member's role and improve it.${title ? `\nRole/Title: ${title}` : ''}
  System prompt to improve:
  """
  ${systemPrompt}
  """
  Return ONLY this exact JSON format (no markdown, no explanation):
  {"revisedPrompt":"improved concise system prompt","expertise":["skill1","skill2","skill3","skill4","skill5"],"traits":["trait1","trait2","trait3"]}`
        : `Create an AI crew member profile from this info:
  Name: ${name || 'Assistant'}
  Title: ${title || 'General Assistant'}
  Description: ${description || 'A helpful AI crew member'}
  Return ONLY this exact JSON format (no markdown, no explanation):
  {"revisedPrompt":"a detailed 2-3 paragraph system prompt defining personality, behavior, domain expertise, communication style, and working methods","expertise":["skill1","skill2","skill3","skill4","skill5"],"traits":["trait1","trait2","trait3"]}`;

      const chunks: string[] = [];
      const modelId = cfg.provider.activeModel || 'gpt-4o-mini';
      for await (const chunk of provider.complete({
        messages: [{ role: 'user', content: genPrompt }],
        model: modelId,
        stream: true,
        maxTokens: 2000,
        temperature: 0.3,
      })) {
        if (chunk.type === 'text_delta' && chunk.content) chunks.push(chunk.content);
      }

      const text = chunks.join('');
      let jsonText = text.match(/\{[\s\S]*\}/)?.[0] || '';
      // Strip markdown code fences if present
      jsonText = jsonText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '');
      jsonText = (jsonText.match(/\{[\s\S]*\}/) || [''])[0] || '';
      if (!jsonText) { res.json({ expertise: [], traits: [], revisedPrompt: '' }); return; }

      const parsed = JSON.parse(jsonText);
      res.json({
        revisedPrompt: typeof parsed.revisedPrompt === 'string' ? parsed.revisedPrompt : '',
        expertise: Array.isArray(parsed.expertise) ? parsed.expertise.slice(0, 8) : [],
        traits: Array.isArray(parsed.traits) ? parsed.traits.slice(0, 8) : [],
      });
    } catch (e: unknown) {
      res.json({ expertise: [], traits: [], revisedPrompt: '' });
    }
  });


  return r;
}
