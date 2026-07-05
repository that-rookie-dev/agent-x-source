import type { AgentXConfig } from '@agentx/shared';

export const REDACTED_SECRET = '••••••••';

function redactProviderEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entry };
  if (typeof out['apiKey'] === 'string' && out['apiKey']) {
    out['apiKey'] = REDACTED_SECRET;
  }
  const profiles = out['profiles'] as Record<string, Record<string, unknown>> | undefined;
  if (profiles) {
    const redactedProfiles: Record<string, Record<string, unknown>> = {};
    for (const [id, prof] of Object.entries(profiles)) {
      redactedProfiles[id] = {
        ...prof,
        apiKey: prof['apiKey'] ? REDACTED_SECRET : prof['apiKey'],
      };
    }
    out['profiles'] = redactedProfiles;
  }
  return out;
}

/** Strip secrets from config before sending to the browser. */
export function redactConfigForClient(config: AgentXConfig): AgentXConfig {
  const providers: Record<string, unknown> = {};
  for (const [id, creds] of Object.entries(config.provider.providers)) {
    providers[id] = redactProviderEntry(creds as unknown as Record<string, unknown>);
  }

  const tools = config.tools?.webSearch
    ? {
        webSearch: Object.fromEntries(
          Object.entries(config.tools.webSearch).map(([k, v]) => {
            if (v && typeof v === 'object' && 'apiKey' in v && (v as { apiKey?: string }).apiKey) {
              return [k, { ...v, apiKey: REDACTED_SECRET }];
            }
            return [k, v];
          }),
        ),
      }
    : config.tools;

  return {
    ...config,
    provider: { ...config.provider, providers: providers as AgentXConfig['provider']['providers'] },
    tools: tools as AgentXConfig['tools'],
  };
}

/** Merge incoming config from client, preserving secrets when redacted placeholders are sent. */
export function mergeConfigPreservingSecrets(existing: AgentXConfig, incoming: AgentXConfig): AgentXConfig {
  const merged = { ...existing, ...incoming, provider: { ...existing.provider, ...incoming.provider } };
  const providers = { ...existing.provider.providers };

  for (const [id, creds] of Object.entries(incoming.provider.providers ?? {})) {
    const prev = providers[id] ?? { configured: false };
    const next = { ...prev, ...creds };
    if (creds.apiKey === REDACTED_SECRET) next.apiKey = prev.apiKey;
    if (creds.profiles) {
      next.profiles = { ...prev.profiles };
      for (const [pid, prof] of Object.entries(creds.profiles)) {
        const prevProf = (prev.profiles?.[pid] ?? {}) as { apiKey?: string; label?: string; baseUrl?: string };
        next.profiles[pid] = {
          ...prevProf,
          ...prof,
          apiKey: prof.apiKey === REDACTED_SECRET ? prevProf.apiKey : prof.apiKey,
        };
      }
    }
    providers[id] = next;
  }

  merged.provider.providers = providers;

  if (incoming.tools?.webSearch) {
    const ws = { ...existing.tools?.webSearch, ...incoming.tools.webSearch };
    for (const key of ['brave', 'exa', 'tavily'] as const) {
      const inc = incoming.tools.webSearch[key];
      const existingEntry = existing.tools?.webSearch?.[key];
      if (inc?.apiKey === REDACTED_SECRET && existingEntry) {
        ws[key] = { ...existingEntry, ...inc, apiKey: existingEntry.apiKey };
      } else if (inc) {
        ws[key] = { ...inc, enabled: inc.enabled ?? false };
      }
    }
    merged.tools = { ...existing.tools, webSearch: ws };
  }

  return merged;
}

/** Provider list for UI — keys redacted, labels preserved. */
export function redactProvidersForClient(
  providers: Record<string, Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return Object.entries(providers).map(([id, creds]) => {
    const entry = redactProviderEntry(creds);
    return { id, ...entry };
  });
}
