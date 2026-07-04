import type { IntegrationActionPreview, IntegrationProvider, ToolDefinition } from '@agentx/shared';
import { parseIntegrationToolId, integrationToolRiskLevel } from './action-classifier.js';
import { getIntegrationProvider } from './catalog/index.js';

const SENSITIVE_KEYS = /token|password|secret|key|auth|credential/i;

function inferResultType(toolName: string): IntegrationActionPreview['resultType'] {
  const n = toolName.toLowerCase();
  if (n.includes('issue') || n.includes('ticket') || n.includes('jira')) return 'issue';
  if (n.includes('calendar') || n.includes('event') || n.includes('meeting')) return 'calendar';
  if (n.includes('hotel') || n.includes('booking') || n.includes('stay') || n.includes('flight')) return 'hotel';
  if (n.includes('message') || n.includes('send') || n.includes('post') || n.includes('slack')) return 'message';
  return 'generic';
}

function humanizeToolName(toolName: string): string {
  return toolName.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildSummary(provider: IntegrationProvider, toolName: string): string {
  return `${provider.name}: ${humanizeToolName(toolName)}`;
}

function buildImpact(provider: IntegrationProvider, toolName: string, riskLevel: IntegrationActionPreview['riskLevel']): string {
  const n = toolName.toLowerCase();
  if (riskLevel === 'critical') {
    if (n.includes('pay') || n.includes('purchase') || n.includes('book')) {
      return 'May charge money or complete a purchase. Review all details before approving.';
    }
    if (n.includes('delete') || n.includes('remove')) {
      return 'May permanently delete data in the connected service.';
    }
    return 'High-impact action on your connected account. Review carefully.';
  }
  if (n.includes('create') || n.includes('add')) return `Creates new data in ${provider.name}.`;
  if (n.includes('update') || n.includes('set') || n.includes('patch')) return `Updates existing data in ${provider.name}.`;
  if (n.includes('send') || n.includes('message')) return `Sends a message via ${provider.name}.`;
  return `Executes a write action via ${provider.name}.`;
}

function formatParamValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 200);
  return String(value);
}

export function buildIntegrationActionPreview(
  toolId: string,
  args: Record<string, unknown>,
  tool?: ToolDefinition,
): IntegrationActionPreview | null {
  const parsed = parseIntegrationToolId(toolId);
  if (!parsed) return null;
  const provider = getIntegrationProvider(parsed.providerId);
  if (!provider) return null;

  const riskLevel = tool?.riskLevel ?? integrationToolRiskLevel(parsed.toolName, provider);
  const parameters = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      value: formatParamValue(value),
      sensitive: SENSITIVE_KEYS.test(key),
    }));

  return {
    providerId: provider.id,
    providerName: provider.name,
    toolId,
    toolName: parsed.toolName,
    riskLevel,
    summary: buildSummary(provider, parsed.toolName),
    impact: buildImpact(provider, parsed.toolName, riskLevel),
    parameters,
    resultType: inferResultType(parsed.toolName),
  };
}
