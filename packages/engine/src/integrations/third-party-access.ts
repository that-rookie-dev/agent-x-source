/**
 * Third-party app/service access policy.
 * External accounts and APIs are reached via MCP integrations or public internet — never by
 * scanning the user's machine for credentials or other apps' private data.
 */

import { detectPlacesSearchRequest, mentionsGoogleMapsProvider } from './places-intent.js';
import {
  integrationToolsForProvider,
  resolveProviderToolAvailability,
  type IntegrationConnectionRef,
} from './integration-tool-availability.js';

export { integrationToolsForProvider } from './integration-tool-availability.js';

export interface IntegrationTurnSnapshotRef {
  connected: Array<IntegrationConnectionRef>;
  unavailable: Array<{
    providerId: string;
    name: string;
    error?: string;
  }>;
}

export interface ThirdPartyServiceIntent {
  category: string;
  providerIds: string[];
  reason: string;
}

export type ThirdPartyHintKind =
  | 'required'
  | 'unavailable'
  | 'service'
  | 'degraded'
  | 'available'
  | 'places'
  | 'read';

export interface ThirdPartyTurnPolicy {
  blockLocalExploration: boolean;
  reason: string;
  providerIds: string[];
  hintKind: ThirdPartyHintKind;
}

export interface ThirdPartyAccessResolution {
  promptHint?: string;
  policy?: ThirdPartyTurnPolicy;
}

export interface CatalogProviderRef {
  id: string;
  name: string;
}

const SERVICE_INTENTS: ReadonlyArray<{
  category: string;
  providerIds: string[];
  patterns: readonly RegExp[];
  reason: string;
}> = [
  {
    category: 'email',
    providerIds: ['gmail'],
    reason: 'Email/inbox request — requires Gmail MCP',
    patterns: [
      /\b(?:email|e-mail|emails|inbox|mailbox|mail\s*box)\b/i,
      /\b(?:unread|new)\s+(?:mail|message|email)s?\b/i,
      /\bgmail\b/i,
      /\b(?:check|read|send|compose|reply\s+to|forward)\s+(?:my\s+)?(?:mail|email)s?\b/i,
      /\b(?:any|how\s+many)\s+(?:unread|new)\s+(?:mail|message|email)/i,
    ],
  },
  {
    category: 'notion',
    providerIds: ['notion'],
    reason: 'Notion request — requires Notion MCP',
    patterns: [/\bnotion\b/i],
  },
  {
    category: 'linear',
    providerIds: ['linear'],
    reason: 'Linear request — requires Linear MCP',
    patterns: [/\blinear\b/i],
  },
  {
    category: 'github',
    providerIds: ['github'],
    reason: 'GitHub remote request — requires GitHub MCP',
    patterns: [
      /\b(?:my\s+)?github\b/i,
      /\bgithub\s+(?:repo|issue|pr|pull\s+request|notification)s?\b/i,
    ],
  },
  {
    category: 'cloud-drive',
    providerIds: ['google-drive'],
    reason: 'Google Drive request — requires Drive MCP',
    patterns: [
      /\bgoogle\s*drive\b/i,
      /\bdrive\s+(?:file|folder|doc)\b/i,
    ],
  },
  {
    category: 'maps',
    providerIds: ['google-maps'],
    reason: 'Maps/places request — requires Google Maps MCP or public web',
    patterns: [/\bgoogle\s*maps?\b/i],
  },
  {
    category: 'payments',
    providerIds: ['stripe', 'paypal', 'shopify'],
    reason: 'Payments/commerce request — requires Stripe/PayPal/Shopify MCP',
    patterns: [/\b(?:stripe|paypal|shopify)\b/i],
  },
  {
    category: 'monitoring',
    providerIds: ['sentry'],
    reason: 'Sentry request — requires Sentry MCP',
    patterns: [/\bsentry\b/i],
  },
  {
    category: 'smart-home',
    providerIds: ['home-assistant'],
    reason: 'Home Assistant request — requires Home Assistant MCP',
    patterns: [/\bhome\s*assistant\b/i],
  },
  {
    category: 'database-remote',
    providerIds: ['postgres', 'redis', 'sqlite'],
    reason: 'Remote database request — requires database MCP integration',
    patterns: [
      /\b(?:my\s+)?(?:postgres|postgresql|redis)\s+(?:db|database|server|instance)\b/i,
    ],
  },
  {
    category: 'slack',
    providerIds: ['slack'],
    reason: 'Slack request — requires Slack MCP',
    patterns: [/\bslack\b/i],
  },
  {
    category: 'discord',
    providerIds: ['discord'],
    reason: 'Discord request — requires Discord MCP',
    patterns: [/\bdiscord\b/i],
  },
  {
    category: 'telegram',
    providerIds: ['telegram'],
    reason: 'Telegram request — requires Telegram MCP',
    patterns: [/\btelegram\b/i],
  },
];

/** Generic “my account / workspace” cues combined with a catalog provider mention. */
const EXTERNAL_ACCOUNT_RE =
  /\b(?:my|our)\s+(?:\w+\s+){0,2}(?:account|workspace|inbox|subscription|dashboard|org|organization)\b/i;

const MCP_MENTION_RE = /\b(?:mcp|integration)\s+(?:server|tool|store)\b/i;

export const SERVICE_PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  slack: 'Slack',
  notion: 'Notion',
  linear: 'Linear',
  github: 'GitHub',
  discord: 'Discord',
  stripe: 'Stripe',
  paypal: 'PayPal',
  shopify: 'Shopify',
  sentry: 'Sentry',
  'google-drive': 'Google Drive',
  'google-maps': 'Google Maps',
  'home-assistant': 'Home Assistant',
  postgres: 'PostgreSQL',
  redis: 'Redis',
  sqlite: 'SQLite',
  'brave-search': 'Brave Search',
  fetch: 'Fetch',
  puppeteer: 'Puppeteer',
};

export function detectThirdPartyServiceIntent(text: string): ThirdPartyServiceIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const intent of SERVICE_INTENTS) {
    if (intent.patterns.some((re) => re.test(trimmed))) {
      return {
        category: intent.category,
        providerIds: [...intent.providerIds],
        reason: intent.reason,
      };
    }
  }

  return null;
}

export function detectMentionedCatalogProviders(
  text: string,
  catalog: CatalogProviderRef[],
): string[] {
  const lower = text.trim().toLowerCase();
  if (!lower) return [];

  const matched = new Set<string>();
  for (const provider of catalog) {
    const id = provider.id.toLowerCase();
    const name = provider.name.toLowerCase();
    if (lower.includes(id) || (name.length >= 4 && lower.includes(name))) {
      matched.add(provider.id);
    }
  }
  return [...matched];
}

export function formatSuggestedProviders(providerIds: string[]): string {
  return providerIds
    .map((id) => SERVICE_PROVIDER_LABELS[id] ?? id)
    .join(' or ');
}

function mentionsProvider(userText: string, providerId: string, name: string): boolean {
  const lower = userText.toLowerCase();
  const id = providerId.toLowerCase();
  const label = name.toLowerCase();
  return lower.includes(id) || (label.length >= 3 && lower.includes(label));
}

function policyFor(
  hintKind: ThirdPartyHintKind,
  reason: string,
  providerIds: string[],
  blockLocal: boolean,
): ThirdPartyTurnPolicy {
  return {
    hintKind,
    reason,
    providerIds,
    blockLocalExploration: blockLocal,
  };
}

/** Integration tool IDs currently registered in the toolkit for a provider. */

function buildConnectedHint(
  entry: IntegrationTurnSnapshotRef['connected'][number],
  availableToolIds: string[],
  category: string,
): ThirdPartyAccessResolution {
  const toolList = availableToolIds.slice(0, 8).join(', ');
  return {
    promptHint: [
      `[INTEGRATION SERVICE] ${entry.name} MCP is connected for this ${category} request.`,
      `Active tools this turn: ${toolList}.`,
      'Call one of these tools now — only use names from your active toolset.',
      'Do NOT use shell, filesystem, or env search on this machine.',
      'If a tool fails, report the error — do not fall back to local credential hunting.',
    ].join(' '),
    policy: policyFor(
      'service',
      `${entry.name} integration is connected — use MCP tools only`,
      [entry.providerId],
      true,
    ),
  };
}

function buildDegradedNoToolsHint(
  entry: { name: string; providerId: string },
  category: string,
): ThirdPartyAccessResolution {
  return {
    promptHint: [
      `[INTEGRATION DEGRADED] ${entry.name} is in MCP Store but no ${entry.name} tools loaded for this ${category} request.`,
      'Tell the user to open Settings → MCP Store, disconnect and reconnect the integration, or restart Agent-X.',
      'Do NOT claim integration tools exist or search this computer for credentials.',
    ].join(' '),
    policy: policyFor(
      'degraded',
      `${entry.name} connected but tools not in active toolset`,
      [entry.providerId],
      true,
    ),
  };
}

export interface ResolveThirdPartyAccessOpts {
  userText: string;
  snapshot: IntegrationTurnSnapshotRef;
  catalog: CatalogProviderRef[];
  /** Google Drive read_file hint when user wants to open a cloud doc */
  driveReadIntent?: boolean;
  /** Tool IDs actually registered in the toolkit after sync (source of truth for hints) */
  registeredIntegrationToolIds?: string[];
}

/**
 * Resolve third-party access for a user turn: prompt hint + executor policy.
 */
export function resolveThirdPartyAccess(opts: ResolveThirdPartyAccessOpts): ThirdPartyAccessResolution {
  const { userText, snapshot, catalog } = opts;
  const lower = userText.toLowerCase();
  if (!lower.trim()) return {};

  const registered = opts.registeredIntegrationToolIds ?? [];

  if (opts.driveReadIntent) {
    const drive = snapshot.connected.find((e) => e.providerId === 'google-drive');
    if (!drive) {
      // fall through to generic resolver
    } else {
      const driveAvailability = resolveProviderToolAvailability(drive, registered);
      const readTool = driveAvailability.availableToolIds.find((id) => id.includes('read_file'));
      if (driveAvailability.toolsReady && readTool) {
        return {
          promptHint: [
            '[INTEGRATION READ] Google Drive is connected.',
            `Use ${readTool} — NOT local filesystem tools.`,
          ].join(' '),
          policy: policyFor('read', 'Google Drive file — MCP only', ['google-drive'], true),
        };
      }
      if (drive.handlersReady && driveAvailability.degradedReason === 'no_registry_tools') {
        return buildDegradedNoToolsHint(drive, 'file read');
      }
    }
  }

  const placesIntent = detectPlacesSearchRequest(userText) || mentionsGoogleMapsProvider(userText);
  if (placesIntent) {
    const maps = snapshot.connected.find((e) => e.providerId === 'google-maps');
    if (maps) {
      const mapsAvailability = resolveProviderToolAvailability(maps, registered);
      const placesTool =
        mapsAvailability.availableToolIds.find((id) => id.includes('maps_search_places'))
        ?? mapsAvailability.availableToolIds[0];
      if (mapsAvailability.toolsReady && placesTool) {
        return {
          promptHint: [
            '[INTEGRATION PLACES] Google Maps MCP is connected.',
            `Use ${placesTool} — NOT filesystem or credential search.`,
          ].join(' '),
          policy: policyFor('places', 'Maps/places — use Google Maps MCP', ['google-maps'], true),
        };
      }
      if (mapsAvailability.degradedReason === 'no_handlers') {
        return {
          promptHint: '[INTEGRATION DEGRADED] Google Maps MCP is not ready. Say Maps is unavailable or use public web_search — do not scan the local system.',
          policy: policyFor('degraded', 'Maps MCP degraded', ['google-maps'], true),
        };
      }
      if (mapsAvailability.degradedReason === 'no_registry_tools') {
        return buildDegradedNoToolsHint(maps, 'places');
      }
    }
    // No maps — public web is acceptable; still block local scavenging
    return {
      promptHint: '[INTEGRATION OPTIONAL] No Google Maps MCP. You may use web_search for public place info — do NOT scan Application Support, gcloud, or home directory.',
      policy: policyFor('required', 'Places query without Maps MCP — web only, no local scan', ['google-maps'], true),
    };
  }

  const serviceIntent = detectThirdPartyServiceIntent(userText);
  const mentionedIds = detectMentionedCatalogProviders(userText, catalog);
  const genericExternal =
    mentionedIds.length > 0 && (EXTERNAL_ACCOUNT_RE.test(userText) || MCP_MENTION_RE.test(userText));

  const providerIds = [
    ...new Set([
      ...(serviceIntent?.providerIds ?? []),
      ...mentionedIds,
    ]),
  ];

  if (providerIds.length === 0 && !genericExternal && !serviceIntent) {
    return {};
  }

  const category = serviceIntent?.category ?? 'third-party app';
  const reason = serviceIntent?.reason ?? 'External app or account request — requires MCP integration';

  const connectedFor = snapshot.connected.filter((e) => providerIds.includes(e.providerId));
  const ready = connectedFor.find((e) => {
    const availability = resolveProviderToolAvailability(e, registered);
    return availability.toolsReady;
  });
  if (ready) {
    const available = integrationToolsForProvider(registered, ready.providerId);
    return buildConnectedHint(ready, available, category);
  }

  const degradedHandlers = connectedFor.find((e) => {
    const availability = resolveProviderToolAvailability(e, registered);
    return availability.degradedReason === 'no_handlers';
  });
  if (degradedHandlers) {
    return {
      promptHint: `[INTEGRATION DEGRADED] ${degradedHandlers.name} MCP is connected but tools are not ready. Tell the user — do not search this computer for credentials.`,
      policy: policyFor('degraded', `${degradedHandlers.name} MCP degraded`, [degradedHandlers.providerId], true),
    };
  }

  const degradedRegistry = connectedFor.find((e) => {
    const availability = resolveProviderToolAvailability(e, registered);
    return availability.degradedReason === 'no_registry_tools';
  });
  if (degradedRegistry) {
    return buildDegradedNoToolsHint(degradedRegistry, category);
  }

  const unavailableFor = snapshot.unavailable.filter((e) => providerIds.includes(e.providerId));
  if (unavailableFor.length > 0) {
    const entry = unavailableFor[0]!;
    return {
      promptHint: [
        `[INTEGRATION UNAVAILABLE] ${entry.name} MCP is not connected`,
        entry.error ? `(${entry.error})` : '',
        'Reconnect in MCP Store → Installed.',
        'Tell the user you cannot access their account without this integration.',
        'Do NOT scan the local filesystem, other apps, shell, or environment.',
      ].filter(Boolean).join(' '),
      policy: policyFor('unavailable', `${entry.name} unavailable`, [entry.providerId], true),
    };
  }

  const suggested = formatSuggestedProviders(providerIds.length > 0 ? providerIds : ['custom MCP']);
  return {
    promptHint: [
      `[INTEGRATION REQUIRED] This request needs a ${category} integration (${suggested} via MCP Store).`,
      'No matching integration is connected.',
      'Tell the user how to connect it — then stop. One short reply.',
      'STRICT: Do NOT use shell, file search, env vars, gcloud, or read configs from other installed apps.',
      'Public internet (web_search) is OK only for openly available info that needs no login.',
    ].join(' '),
    policy: policyFor('required', reason, providerIds, true),
  };
}

/** Also handle explicit provider name in message (legacy path in integration hub). */
export function resolveMentionedProviderAccess(
  userText: string,
  snapshot: IntegrationTurnSnapshotRef,
  registeredIntegrationToolIds: string[] = [],
): ThirdPartyAccessResolution | undefined {
  for (const entry of snapshot.unavailable) {
    if (!mentionsProvider(userText, entry.providerId, entry.name)) continue;
    return {
      promptHint: [
        `[INTEGRATION UNAVAILABLE] ${entry.name} MCP is not connected`,
        entry.error ? `(${entry.error})` : '',
        'Reconnect in MCP Store. Do NOT scan the local filesystem.',
      ].filter(Boolean).join(' '),
      policy: policyFor('unavailable', `${entry.name} unavailable`, [entry.providerId], true),
    };
  }

  for (const entry of snapshot.connected) {
    if (!mentionsProvider(userText, entry.providerId, entry.name)) continue;
    const availability = resolveProviderToolAvailability(entry, registeredIntegrationToolIds);
    if (availability.degradedReason === 'no_handlers') {
      return {
        promptHint: `[INTEGRATION DEGRADED] ${entry.name} MCP is not ready. Do not substitute local filesystem search.`,
        policy: policyFor('degraded', `${entry.name} degraded`, [entry.providerId], true),
      };
    }
    if (availability.toolsReady) {
      return buildConnectedHint(entry, availability.availableToolIds, entry.name);
    }
    return buildDegradedNoToolsHint(entry, entry.name);
  }

  return undefined;
}
