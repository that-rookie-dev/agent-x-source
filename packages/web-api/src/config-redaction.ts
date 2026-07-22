import type { AgentXConfig, WebSearchToolsConfig } from '@agentx/shared';

/** @deprecated Legacy placeholder — never send or persist. Kept for merge of old clients. */
export const REDACTED_SECRET = '••••••••';

function isCorruptSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return !v || v === REDACTED_SECRET || v.includes('•') || v === '***' || v === '********';
}

/**
 * Clear secrets that were accidentally persisted as redacted placeholders.
 * Returns a cleaned config when repairs were made, otherwise null.
 */
export function scrubPersistedSecretPlaceholders(config: AgentXConfig): AgentXConfig | null {
  let dirty = false;
  const next: AgentXConfig = {
    ...config,
    provider: { ...config.provider, providers: { ...config.provider.providers } },
    tools: config.tools ? { ...config.tools } : config.tools,
    voice: config.voice ? { ...config.voice } : config.voice,
  };

  for (const [id, creds] of Object.entries(next.provider.providers)) {
    const c = { ...(creds as unknown as Record<string, unknown>) };
    if (isCorruptSecret(c['apiKey'])) {
      c['apiKey'] = '';
      dirty = true;
    }
    if (c['profiles'] && typeof c['profiles'] === 'object') {
      const profiles: Record<string, Record<string, unknown>> = {};
      for (const [pid, prof] of Object.entries(c['profiles'] as Record<string, Record<string, unknown>>)) {
        const p = { ...prof };
        if (isCorruptSecret(p['apiKey'])) {
          p['apiKey'] = '';
          dirty = true;
        }
        profiles[pid] = p;
      }
      c['profiles'] = profiles;
    }
    (next.provider.providers as Record<string, unknown>)[id] = c;
  }

  if (next.tools?.webSearch) {
    const ws = { ...next.tools.webSearch };
    for (const key of ['brave', 'exa', 'tavily'] as const) {
      const entry = ws[key];
      if (entry && isCorruptSecret(entry.apiKey)) {
        ws[key] = { ...entry, apiKey: '' };
        dirty = true;
      }
    }
    next.tools = { ...next.tools, webSearch: ws };
  }

  if (next.voice?.xai && isCorruptSecret(next.voice.xai.apiKey)) {
    next.voice = {
      ...next.voice,
      xai: { ...next.voice.xai, apiKey: '' },
    };
    dirty = true;
  }

  return dirty ? next : null;
}

function redactProviderEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entry };
  if (typeof out['apiKey'] === 'string' && out['apiKey']) {
    out['apiKeyConfigured'] = true;
    delete out['apiKey'];
  } else {
    out['apiKeyConfigured'] = false;
    delete out['apiKey'];
  }
  const profiles = out['profiles'] as Record<string, Record<string, unknown>> | undefined;
  if (profiles) {
    const redactedProfiles: Record<string, Record<string, unknown>> = {};
    for (const [id, prof] of Object.entries(profiles)) {
      const hasKey = Boolean(prof['apiKey']);
      const { apiKey: _drop, ...rest } = prof;
      redactedProfiles[id] = {
        ...rest,
        apiKeyConfigured: hasKey,
      };
    }
    out['profiles'] = redactedProfiles;
  }
  return out;
}

function redactWebSearchForClient(webSearch: WebSearchToolsConfig | undefined): WebSearchToolsConfig | undefined {
  if (!webSearch) return webSearch;
  const out: WebSearchToolsConfig = {
    duckduckgo: webSearch.duckduckgo,
    providerOrder: webSearch.providerOrder,
  };
  for (const key of ['brave', 'exa', 'tavily'] as const) {
    const entry = webSearch[key];
    if (!entry) continue;
    out[key] = {
      enabled: entry.enabled,
      apiKeyConfigured: Boolean(entry.apiKey?.trim()),
    };
  }
  return out;
}

/** Strip secrets from config before sending to the browser. Never send key material. */
export function redactConfigForClient(config: AgentXConfig): AgentXConfig {
  const providers: Record<string, unknown> = {};
  for (const [id, creds] of Object.entries(config.provider.providers)) {
    providers[id] = redactProviderEntry(creds as unknown as Record<string, unknown>);
  }

  const tools = config.tools
    ? {
        ...config.tools,
        webSearch: redactWebSearchForClient(config.tools.webSearch),
      }
    : config.tools;

  const voice = config.voice
    ? {
        ...config.voice,
        xai: config.voice.xai
          ? {
              ...config.voice.xai,
              apiKeyConfigured: Boolean(config.voice.xai.apiKey?.trim()),
              apiKey: undefined,
            }
          : config.voice.xai,
      }
    : config.voice;

  return {
    ...config,
    provider: { ...config.provider, providers: providers as AgentXConfig['provider']['providers'] },
    tools: tools as AgentXConfig['tools'],
    voice,
  };
}

function isLegacyRedacted(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v === REDACTED_SECRET || /^•+$/.test(v) || v.includes('•');
}

/** Merge incoming config from client, preserving secrets when keys are omitted / cleared via flag. */
export function mergeConfigPreservingSecrets(existing: AgentXConfig, incoming: AgentXConfig): AgentXConfig {
  const merged = { ...existing, ...incoming, provider: { ...existing.provider, ...incoming.provider } };
  const providers = { ...existing.provider.providers };

  for (const [id, creds] of Object.entries(incoming.provider.providers ?? {})) {
    const prev = providers[id] ?? { configured: false };
    const next = { ...prev, ...creds };
    const incomingKey = creds.apiKey;
    const configuredFlag = (creds as { apiKeyConfigured?: boolean }).apiKeyConfigured;
    if (configuredFlag === false) {
      next.apiKey = '';
    } else if (typeof incomingKey === 'string' && incomingKey.trim() && !isLegacyRedacted(incomingKey)) {
      next.apiKey = incomingKey.trim();
    } else {
      next.apiKey = prev.apiKey;
    }
    delete (next as { apiKeyConfigured?: boolean }).apiKeyConfigured;

    if (creds.profiles) {
      next.profiles = { ...prev.profiles };
      for (const [pid, prof] of Object.entries(creds.profiles)) {
        const prevProf = (prev.profiles?.[pid] ?? {}) as { apiKey?: string; label?: string; baseUrl?: string };
        const profFlag = (prof as { apiKeyConfigured?: boolean }).apiKeyConfigured;
        let apiKey = prevProf.apiKey;
        if (profFlag === false) apiKey = '';
        else if (typeof prof.apiKey === 'string' && prof.apiKey.trim() && !isLegacyRedacted(prof.apiKey)) {
          apiKey = prof.apiKey.trim();
        }
        const { apiKeyConfigured: _c, ...profRest } = prof as { apiKeyConfigured?: boolean } & typeof prof;
        next.profiles[pid] = {
          ...prevProf,
          ...profRest,
          apiKey,
        };
      }
    }
    providers[id] = next;
  }

  merged.provider.providers = providers;

  if (incoming.voice?.xai) {
    const prevKey = existing.voice?.xai?.apiKey;
    const incKey = incoming.voice.xai.apiKey;
    const flag = (incoming.voice.xai as { apiKeyConfigured?: boolean }).apiKeyConfigured;
    let apiKey = prevKey;
    if (flag === false) apiKey = '';
    else if (typeof incKey === 'string' && incKey.trim() && !isLegacyRedacted(incKey)) apiKey = incKey.trim();
    merged.voice = {
      ...existing.voice,
      ...incoming.voice,
      xai: {
        ...existing.voice?.xai,
        ...incoming.voice.xai,
        apiKey,
      },
    };
    delete (merged.voice.xai as { apiKeyConfigured?: boolean }).apiKeyConfigured;
  }

  return merged;
}

/** Provider list for UI — keys never included; configured flag only. */
export function redactProvidersForClient(
  providers: Record<string, Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return Object.entries(providers).map(([id, creds]) => {
    const entry = redactProviderEntry(creds);
    return { id, ...entry };
  });
}
