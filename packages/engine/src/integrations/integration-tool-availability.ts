/**
 * Generic MCP integration tool availability — registry + active toolset reconciliation.
 * Applies to every MCP provider (catalog, custom, stdio, OAuth, etc.).
 */

import {
  integrationToolUnregisterPrefixes,
  isIntegrationToolId,
  parseIntegrationToolId,
} from './action-classifier.js';
import type { ThirdPartyTurnPolicy } from './third-party-access.js';

export interface IntegrationConnectionRef {
  providerId: string;
  name: string;
  toolCount: number;
  handlersReady: boolean;
  /** Tools registered in the toolkit after sync (any MCP server). */
  activeToolCount?: number;
  /** Session handlers exist and toolkit has integration__{provider}__* tools. */
  toolsReady?: boolean;
}

/** Integration tool IDs in the toolkit for any provider id. */
export function integrationToolsForProvider(toolIds: string[], providerId: string): string[] {
  const prefixes = integrationToolUnregisterPrefixes(providerId);
  return toolIds.filter((id) => prefixes.some((prefix) => id.startsWith(prefix)));
}

export interface ProviderToolAvailability {
  availableToolIds: string[];
  toolsReady: boolean;
  degradedReason?: 'no_handlers' | 'no_registry_tools';
}

/** Resolve whether an MCP connection is usable this turn (handlers + registry). */
export function resolveProviderToolAvailability(
  entry: Pick<IntegrationConnectionRef, 'providerId' | 'handlersReady'>,
  registeredToolIds: string[],
): ProviderToolAvailability {
  const availableToolIds = integrationToolsForProvider(registeredToolIds, entry.providerId);
  if (!entry.handlersReady) {
    return { availableToolIds, toolsReady: false, degradedReason: 'no_handlers' };
  }
  if (availableToolIds.length === 0) {
    return { availableToolIds, toolsReady: false, degradedReason: 'no_registry_tools' };
  }
  return { availableToolIds, toolsReady: true };
}

export function enrichConnectionAvailability<T extends IntegrationConnectionRef>(
  entry: T,
  registeredToolIds: string[],
): T {
  const availability = resolveProviderToolAvailability(entry, registeredToolIds);
  return {
    ...entry,
    activeToolCount: availability.availableToolIds.length,
    toolsReady: availability.toolsReady,
  };
}

const INTEGRATION_READY_HINT_RE = /\[INTEGRATION (SERVICE|READ|PLACES)\]/;

function activeToolsForPolicy(activeToolIds: string[], policy?: ThirdPartyTurnPolicy): string[] {
  const integrationIds = activeToolIds.filter(isIntegrationToolId);
  const providerIds = policy?.providerIds ?? [];
  if (providerIds.length === 0) return integrationIds;
  return integrationIds.filter((id) => {
    const parsed = parseIntegrationToolId(id);
    return parsed != null && providerIds.includes(parsed.providerId);
  });
}

function providerLabel(policy: ThirdPartyTurnPolicy | undefined, fallback = 'MCP integration'): string {
  const id = policy?.providerIds?.[0];
  return id ?? fallback;
}

function buildDegradedActiveToolsetHint(label: string): string {
  return [
    `[INTEGRATION DEGRADED] ${label} tools are not in this session's active toolset.`,
    'Tell the user to open Settings → MCP Store, reconnect the integration, or restart Agent-X.',
    'Do NOT claim integration tools exist or search this computer for credentials.',
  ].join(' ');
}

/**
 * Final pass after tool permission / compact-context filtering: align turn hints with tools
 * the model can actually call. Works for any MCP server.
 *
 * @param discoveryToolIds Optional full registry IDs. When progressive disclosure exposes
 *   only tool_search/tool_call, provider tools may be absent from `activeToolIds` but still
 *   callable via the bridge — pass discovery IDs so we do not false-degrade.
 */
export function reconcileIntegrationHintWithActiveTools(
  hint: string | undefined,
  policy: ThirdPartyTurnPolicy | undefined,
  activeToolIds: string[],
  discoveryToolIds?: string[],
): { hint?: string; policy?: ThirdPartyTurnPolicy } {
  if (!hint?.trim()) return { hint, policy };
  if (!INTEGRATION_READY_HINT_RE.test(hint)) return { hint, policy };

  const activeForPolicy = activeToolsForPolicy(activeToolIds, policy);
  if (activeForPolicy.length === 0) {
    const bridgeReady = activeToolIds.includes('tool_search') && activeToolIds.includes('tool_call');
    const discoverable = discoveryToolIds
      ? activeToolsForPolicy(discoveryToolIds, policy)
      : [];
    if (bridgeReady && discoverable.length > 0) {
      const toolList = discoverable.slice(0, 8).join(', ');
      return {
        hint: [
          hint.replace(/Active tools this turn: [^.]+\./, `Discoverable MCP tools: ${toolList}.`),
          `Use tool_search / tool_call for: ${toolList}.`,
        ].join(' '),
        policy,
      };
    }
    return {
      hint: buildDegradedActiveToolsetHint(providerLabel(policy)),
      policy: policy
        ? {
            ...policy,
            hintKind: 'degraded',
            reason: 'MCP tools not in active toolset after session filters',
          }
        : undefined,
    };
  }

  const toolList = activeForPolicy.slice(0, 8).join(', ');
  if (hint.includes('Active tools this turn:')) {
    return {
      hint: hint.replace(/Active tools this turn: [^.]+\./, `Active tools this turn: ${toolList}.`),
      policy,
    };
  }

  // Legacy or specialized hints (READ / PLACES): ensure named tool is still active.
  const namedToolMatch = hint.match(/Use (integration__[^\s—]+)/);
  if (namedToolMatch && !activeForPolicy.includes(namedToolMatch[1]!)) {
    const replacement = activeForPolicy[0]!;
    return {
      hint: hint.replace(namedToolMatch[1]!, replacement),
      policy,
    };
  }

  return { hint, policy };
}
