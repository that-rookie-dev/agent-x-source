/**
 * Provider catalog and validation helpers extracted from legacy.ts.
 *
 * Exports the AVAILABLE_PROVIDERS list and validateProviderConfig so that
 * sub-router modules (e.g. system.ts) can reuse them without duplication.
 */
import type { AgentXConfig, ProviderId } from '@agentx/shared';
import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine, destroyAgent, createAgent } from '../../engine.js';
import { ProviderFactory } from '@agentx/engine';
import { REDACTED_SECRET, redactProvidersForClient } from '../../config-redaction.js';
import { refreshIngestionWorkerGenerator } from '../../ingestion-worker-ref.js';
import { ensureSubscribed } from '../../ws.js';


export const AVAILABLE_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'google', name: 'Google', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'moonshot', name: 'Moonshot AI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.ai/v1' },
  { id: 'deepseek', name: 'DeepSeek', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { id: 'groq', name: 'Groq', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', name: 'Mistral AI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.mistral.ai/v1' },
  { id: 'together', name: 'Together AI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.together.xyz/v1' },
  { id: 'xai', name: 'xAI (Grok)', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.x.ai/v1' },
  { id: 'fireworks', name: 'Fireworks AI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'perplexity', name: 'Perplexity', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.perplexity.ai' },
  { id: 'azure', name: 'Azure OpenAI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: '' },
  { id: 'cohere', name: 'Cohere', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.cohere.com/v2' },
  { id: 'commandcode', name: 'CommandCode', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.commandcode.ai/provider/v1' },
  { id: 'opencode', name: 'OpenCode Go', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://opencode.ai/zen/go/v1' },
  { id: 'opencode-zen', name: 'OpenCode Zen', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://opencode.ai/zen/v1' },
  { id: 'ollama', name: 'Ollama', type: 'local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:11434' },
  { id: 'lmstudio', name: 'LM Studio', type: 'local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:1234/v1' },
];

/**
 * Validate that a config has at least one usable provider with an API key
 * (or a local provider that doesn't require one) and that activeProvider
 * points to a configured provider. Returns an error message string if
 * invalid, or null if valid.
 */
export function validateProviderConfig(cfg: AgentXConfig): string | null {
  if (!cfg.provider) return 'Missing provider configuration';
  const providers = cfg.provider.providers ?? {};
  // Local providers that don't require an API key
  const LOCAL_PROVIDER_IDS = new Set(AVAILABLE_PROVIDERS.filter(p => p.type === 'local' || !p.requiresApiKey).map(p => p.id));
  // Count configured providers (have apiKey or are local/no-key providers)
  const configuredProviders = Object.entries(providers).filter(([id, p]) => {
    if (!p?.configured) return false;
    if (LOCAL_PROVIDER_IDS.has(id as ProviderId)) return true;
    // Has direct apiKey, or has at least one profile with an apiKey
    return !!p.apiKey || (!!p.profiles && Object.values(p.profiles).some(prof => !!prof.apiKey));
  });
  if (configuredProviders.length === 0) {
    return 'Cannot save configuration with no configured providers. At least one provider with a valid API key is required.';
  }
  // Check that activeProvider is configured
  const activeId = cfg.provider.activeProvider;
  if (!activeId || !providers[activeId]?.configured) {
    return `Active provider "${activeId ?? 'none'}" is not configured. Set activeProvider to a configured provider.`;
  }
  // If the active provider has profiles, check it has at least one
  const activeProv = providers[activeId];
  if (activeProv.profiles) {
    const profileCount = Object.keys(activeProv.profiles).length;
    if (profileCount === 0) {
      return `Active provider "${activeId}" has no profiles. Add at least one profile before removing others.`;
    }
  }
  return null;
}

export function createProvidersRouter(): Router {
  const r = Router();

  r.get('/api/providers/available', (_req, res) => {
    res.json({ providers: AVAILABLE_PROVIDERS });
  });

  r.post('/api/provider/validate', async (req, res) => {
    try {
      const { provider, baseUrl } = req.body as { provider: string; apiKey?: string; baseUrl?: string };
      let apiKey = req.body?.apiKey as string | undefined;
      if (!apiKey || apiKey === REDACTED_SECRET) {
        try {
          const eng = getEngine();
          const cfg = eng.configManager.load();
          const creds = cfg.provider.providers[provider as ProviderId];
          if (creds?.activeProfile && creds.profiles?.[creds.activeProfile]) {
            apiKey = creds.profiles[creds.activeProfile]?.apiKey;
          }
          if (!apiKey) apiKey = creds?.apiKey;
        } catch {
          apiKey = undefined;
        }
      }
      const prov = ProviderFactory.create(provider as ProviderId, apiKey, baseUrl);
      const valid = await prov.validate();
      if (valid) {
        res.json({ valid: true, provider: prov.id, name: prov.name });
      } else {
        res.status(400).json({ valid: false, error: 'provider-unreachable' });
      }
    } catch (e: unknown) {
      getLogger().error('POST_API_PROVIDER_VALIDATE', e instanceof Error ? e : String(e));    res.status(400).json({ valid: false, error: e instanceof Error ? e.message : 'unknown-error' });
    }
  });

  r.get('/api/provider/models', async (req, res) => {
    try {
      if (req.query['apiKey']) {
        return res.status(400).json({ error: 'apiKey query parameter is not allowed — configure keys in Settings' });
      }
      let providerId = (req.query['provider'] as string) || '';
      let apiKey: string | undefined;
      let baseUrl = (req.query['baseUrl'] as string) || undefined;
      if (!apiKey && !baseUrl) {
        try {
          const eng = getEngine();
          const cfg = eng.configManager.load();
          // Resolve profile label → actual provider type (e.g. "OCZ-Personal" → "openai")
          if (!cfg.provider.providers[providerId]) {
            for (const [pid, pcfg] of Object.entries(cfg.provider.providers)) {
              if (pcfg.profiles?.[providerId] || pcfg.activeProfile === providerId) {
                providerId = pid;
                break;
              }
            }
          }
          const creds = cfg.provider.providers[providerId];
          if (creds?.activeProfile && creds.profiles?.[creds.activeProfile]) {
            const active = creds.profiles[creds.activeProfile] as { apiKey?: string; baseUrl?: string } | undefined;
            if (active) {
              apiKey = active.apiKey;
              baseUrl = active.baseUrl;
            }
          }
          // Fallback: use flat apiKey/baseUrl on the provider creds if no profile matched
          if (!apiKey && creds?.apiKey) apiKey = creds.apiKey;
          if (!baseUrl && creds?.baseUrl) baseUrl = creds.baseUrl;
        } catch (e) { /* use provided values */ }
      }
      const prov = ProviderFactory.create(providerId as ProviderId, apiKey, baseUrl);
      const models = await prov.listModels();
      res.json(models);
    } catch (e: unknown) {
      getLogger().error('GET_API_PROVIDER_MODELS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'failed-to-list-models' });
    }
  });

  r.post('/api/provider/configure', (req, res) => {
    try {
      const { provider, apiKey, baseUrl, profileName } = req.body as { provider: string; apiKey?: string; baseUrl?: string; profileName?: string };
      if (!profileName || typeof profileName !== 'string' || !profileName.trim()) {
        res.status(400).json({ error: 'profileName is required. Provide a name for your provider profile (e.g. "My OpenAI Key" or "Work Account").' });
        return;
      }
      const profileId = profileName.trim();
      destroyAgent();
      const eng = getEngine();

      let config: AgentXConfig;
      try {
        config = eng.configManager.load();
      } catch (e) {
        config = { provider: { activeProvider: provider as ProviderId, activeModel: '', providers: {} }, ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' }, organization: null, telemetry: false };
      }

      config.provider.activeProvider = provider as ProviderId;
      const providerCfg = config.provider.providers[provider] ?? { configured: false };
      const availableProv = AVAILABLE_PROVIDERS.find(p => p.id === provider);
      if (apiKey) {
        providerCfg.apiKey = apiKey;
      } else if (availableProv && !availableProv.requiresApiKey) {
        providerCfg.apiKey = '';
      }
      if (baseUrl) providerCfg.baseUrl = baseUrl;
      providerCfg.configured = true;
      config.provider.providers[provider] = providerCfg;

      eng.configManager.save(config);

      // Create a profile for this provider configuration
      eng.configManager.addProviderProfile(provider, profileId, {
        label: profileId,
        apiKey,
        baseUrl,
        createdAt: new Date().toISOString(),
      }, true);
      const cfg = eng.configManager.load();
      cfg.provider.activeProvider = provider as ProviderId;
      eng.configManager.save(cfg);

      res.json({ ok: true, provider, profileId });
    } catch (e: unknown) {
      getLogger().error('POST_API_PROVIDER_CONFIGURE', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
    }
  });

  r.get('/api/providers', (_req, res) => {
    const eng = getEngine();
    try {
      const config = eng.configManager.load();
      const configured = redactProvidersForClient(
        config.provider.providers as unknown as Record<string, Record<string, unknown>>,
      ).filter((p) => p['configured']);
      res.json({ active: config.provider.activeProvider, providers: configured });
    } catch (e) {
      res.json({ active: '', providers: [] });
    }
  });

  r.post('/api/provider/profile', (req, res) => {
    try {
      const { provider, profileId, label, apiKey, baseUrl, setActive } = req.body as {
        provider: string; profileId: string; label?: string; apiKey?: string; baseUrl?: string; setActive?: boolean;
      };
      if (!label || typeof label !== 'string' || !label.trim()) {
        res.status(400).json({ error: 'label is required. Provide a name for your profile (e.g. "My OpenAI Key" or "Work Account").' });
        return;
      }
      const eng = getEngine();
      eng.configManager.addProviderProfile(provider, profileId, {
        label: label.trim(),
        apiKey,
        baseUrl,
        createdAt: new Date().toISOString(),
      }, setActive !== false);
      if (setActive !== false) {
        destroyAgent();
        const cfg = eng.configManager.load();
        cfg.provider.activeProvider = provider as ProviderId;
        eng.configManager.save(cfg);
      }
      res.json({ ok: true, provider, profileId });
    } catch (e: unknown) {
      getLogger().error('POST_API_PROVIDER_PROFILE', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'profile-add-failed' });
    }
  });

  r.post('/api/provider/profile/switch', (req, res) => {
    try {
      const { providerId, profileId } = req.body as { providerId?: string; profileId: string };
      const eng = getEngine();
      // The provider to switch to is determined by which provider owns this profile
      const cfg = eng.configManager.load();
      let targetProvider = providerId;
      if (!targetProvider) {
        // Find which provider config contains this profile
        for (const [pid, pcfg] of Object.entries(cfg.provider.providers)) {
          if (pcfg.profiles && pcfg.profiles[profileId]) {
            targetProvider = pid;
            break;
          }
        }
      }
      if (!targetProvider) { res.status(400).json({ error: 'Unable to determine provider for profile' }); return; }
      eng.configManager.setActiveProviderProfile(targetProvider, profileId);
      destroyAgent();
      const sess = eng.sessionManager.getActiveSession();
      if (sess) createAgent(undefined, sess);
      res.json({ ok: true, provider: targetProvider, profileId });
    } catch (e: unknown) {
      getLogger().error('POST_API_PROVIDER_PROFILE_SWITCH', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
    }
  });

  r.post('/api/provider/profile/rename', (req, res) => {
    try {
      const { provider, profileId, label } = req.body as { provider: string; profileId: string; label: string };
      if (!label) { res.status(400).json({ error: 'label required' }); return; }
      const eng = getEngine();
      eng.configManager.renameProviderProfile(provider, profileId, label);
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('POST_API_PROVIDER_PROFILE_RENAME', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'rename-failed' });
    }
  });

  r.delete('/api/provider/:providerId/profile/:profileId', (req, res) => {
    try {
      const { providerId, profileId } = req.params;
      const eng = getEngine();
      const cfg = eng.configManager.load();

      // Count total configured profiles across all providers
      const allProviders = cfg.provider.providers ?? {};
      let totalProfiles = 0;
      let providerProfileCount = 0;
      for (const [id, p] of Object.entries(allProviders)) {
        if (p?.profiles) {
          const count = Object.keys(p.profiles).length;
          totalProfiles += count;
          if (id === providerId) providerProfileCount = count;
        } else if (p?.configured && p?.apiKey) {
          // Legacy single-key provider (no profiles) counts as 1
          totalProfiles += 1;
          if (id === providerId) providerProfileCount += 1;
        }
      }

      // Guard 1: Cannot delete if this is the last profile overall
      if (totalProfiles <= 1) {
        res.status(400).json({
          error: 'last-profile',
          message: 'Cannot delete the last remaining provider profile. At least one provider must be configured at all times.',
        });
        return;
      }

      // Guard 2: Cannot delete the last profile for the active provider
      const isActiveProvider = cfg.provider.activeProvider === providerId;
      if (isActiveProvider && providerProfileCount <= 1) {
        res.status(400).json({
          error: 'last-active-profile',
          message: 'Cannot delete the last profile for the active provider. Switch to another provider first or add another profile.',
        });
        return;
      }

      eng.configManager.removeProviderProfile(providerId, profileId);
      // Rebuild ingestion worker generator in case provider config changed
      void refreshIngestionWorkerGenerator();
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('DELETE_API_PROVIDER_PROFILE', e instanceof Error ? e : String(e));
      res.status(400).json({ error: e instanceof Error ? e.message : 'delete-failed' });
    }
  });

  r.post('/api/provider/switch', (req, res) => {
    try {
      const { provider } = req.body as { provider: string };
      if (!provider) { res.status(400).json({ error: 'provider-required' }); return; }
      const eng = getEngine();
      const config = eng.configManager.load();
      config.provider.activeProvider = provider as ProviderId;
      config.provider.activeModel = ''; // Clear model on provider change
      eng.configManager.save(config);
      destroyAgent();
      res.json({ ok: true, provider, model: '' });
    } catch (e: unknown) {
      getLogger().error('POST_API_PROVIDER_SWITCH', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
    }
  });

  r.post('/api/model/switch', (req, res) => {
    try {
      const { modelId, providerId, contextWindow, reasoningEffort } = req.body as {
        modelId: string;
        providerId?: string;
        contextWindow?: number;
        reasoningEffort?: string;
      };
      const eng = getEngine();
      const config = eng.configManager.load();

      if (providerId && providerId !== config.provider.activeProvider) {
        config.provider.activeProvider = providerId as ProviderId;
        config.provider.activeModel = modelId;
        if (reasoningEffort) config.provider.activeReasoningEffort = reasoningEffort as import('@agentx/shared').ReasoningEffortLevel;
        eng.configManager.save(config);
        destroyAgent();
        const sess = eng.sessionManager.getActiveSession();
        if (sess) {
          eng.sessionManager.syncActiveSessionRuntime({
            providerId: config.provider.activeProvider,
            modelId,
          });
          createAgent(undefined, sess);
        }
        ensureSubscribed();
      } else {
        config.provider.activeModel = modelId;
        if (reasoningEffort !== undefined) {
          config.provider.activeReasoningEffort = reasoningEffort
            ? (reasoningEffort as import('@agentx/shared').ReasoningEffortLevel)
            : undefined;
        }
        eng.configManager.save(config);
        if (eng.agent) {
          eng.agent.switchModel(modelId, contextWindow);
        }
        const sess = eng.sessionManager.getActiveSession();
        if (sess) {
          eng.sessionManager.syncActiveSessionRuntime({
            providerId: config.provider.activeProvider,
            modelId,
          });
        }
      }

      res.json({
        ok: true,
        model: modelId,
        provider: providerId ?? config.provider.activeProvider,
        reasoningEffort: config.provider.activeReasoningEffort,
      });
    } catch (e: unknown) {
      getLogger().error('POST_API_MODEL_SWITCH', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
    }
  });

  r.post('/api/model/trial', async (req, res) => {
    try {
      const { modelId } = req.body as { modelId: string };
      const eng = getEngine();
      const cfg = eng.configManager.load();
      const providerCfg = cfg.provider.providers?.[cfg.provider.activeProvider];
      const provider = ProviderFactory.create(
        cfg.provider.activeProvider,
        providerCfg?.apiKey,
        providerCfg?.baseUrl,
      );
      const request = {
        model: modelId,
        messages: [{ role: 'user' as const, content: 'hi' }],
        maxTokens: 1,
        temperature: 0,
      };
      for await (const _chunk of provider.complete(request)) {
        break;
      }
      res.json({ ok: true, model: modelId });
    } catch (e: unknown) {
      getLogger().error('POST_API_MODEL_TRIAL', e instanceof Error ? e : String(e));    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'trial-failed' });
    }
  });

  r.get('/api/models', async (_req, res) => {
    try {
      const eng = getEngine();
      const config = eng.configManager.load();
      // Try to list models via agent if it exists, but don't fail if no agent
      if (eng.agent) {
        try { await eng.agent.listModels(); } catch (e) { /* ignore */ }
      }
      const activeProfile = config.provider.providers[config.provider.activeProvider]?.activeProfile;
      res.json({ model: config.provider.activeModel, provider: config.provider.activeProvider, providerId: config.provider.activeProvider, activeProfile, currentModel: config.provider.activeModel });
    } catch (e: unknown) {
      getLogger().error('GET_API_MODELS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
    }
  });


  return r;
}
