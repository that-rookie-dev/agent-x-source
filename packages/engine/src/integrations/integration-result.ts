import { parseIntegrationToolId } from './action-classifier.js';
import { getIntegrationProvider } from './catalog/index.js';

export type IntegrationResultType = 'generic' | 'issue' | 'calendar' | 'hotel' | 'message';

export interface IntegrationStructuredResult {
  resultType: IntegrationResultType;
  providerName: string;
  toolName: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  raw: string;
}

function inferResultType(toolName: string): IntegrationResultType {
  const n = toolName.toLowerCase();
  if (n.includes('issue') || n.includes('ticket') || n.includes('jira')) return 'issue';
  if (n.includes('calendar') || n.includes('event') || n.includes('meeting')) return 'calendar';
  if (n.includes('hotel') || n.includes('booking') || n.includes('stay') || n.includes('flight')) return 'hotel';
  if (n.includes('message') || n.includes('send') || n.includes('post') || n.includes('slack')) return 'message';
  return 'generic';
}

function pickFields(obj: Record<string, unknown>, keys: string[]): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null || value === '') continue;
    fields.push({
      label: key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    });
  }
  return fields;
}

function extractFromObject(obj: Record<string, unknown>, resultType: IntegrationResultType): Array<{ label: string; value: string }> {
  switch (resultType) {
    case 'issue':
      return pickFields(obj, ['title', 'id', 'number', 'state', 'status', 'assignee', 'url', 'link']);
    case 'calendar':
      return pickFields(obj, ['title', 'summary', 'start', 'end', 'location', 'attendees', 'id']);
    case 'hotel':
      return pickFields(obj, ['name', 'hotel', 'checkIn', 'checkOut', 'price', 'total', 'confirmation', 'bookingId']);
    case 'message':
      return pickFields(obj, ['channel', 'to', 'recipient', 'text', 'body', 'message', 'id', 'ts']);
    default:
      return pickFields(obj, ['title', 'name', 'id', 'status', 'summary', 'description', 'url']);
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseIntegrationStructuredResult(toolId: string, output: string): IntegrationStructuredResult | null {
  const parsed = parseIntegrationToolId(toolId);
  if (!parsed) return null;
  const provider = getIntegrationProvider(parsed.providerId);
  if (!provider) return null;

  const resultType = inferResultType(parsed.toolName);
  const raw = output.trim();
  if (!raw) return null;

  let fields: Array<{ label: string; value: string }> = [];
  let title = `${provider.name}: ${parsed.toolName.replace(/[_-]+/g, ' ')}`;

  const json = tryParseJson(raw);
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    fields = extractFromObject(obj, resultType);
    const named = obj.title ?? obj.name ?? obj.summary ?? obj.subject;
    if (typeof named === 'string' && named.trim()) title = named.trim();
  } else if (raw.includes('\n')) {
    const lines = raw.split('\n').filter(Boolean).slice(0, 8);
    fields = lines.map((line, index) => ({ label: `Line ${index + 1}`, value: line }));
  } else {
    fields = [{ label: 'Result', value: raw.slice(0, 500) }];
  }

  return {
    resultType,
    providerName: provider.name,
    toolName: parsed.toolName,
    title,
    fields: fields.slice(0, 10),
    raw,
  };
}
