const PROVIDER_PREFIX_RE =
  /^(?:[\w.-]+\s+)?API\s+error(?:\s*\((\d+)\)|:\s*(\d+))\s*[-:]\s*/i;

const HUMAN_ERROR_SNIPPET_RE =
  /Invalid '[^']+':[^"\\]+(?:Expected[^"\\]+)?/;

const GARBAGE_ONLY_RE = /^[{[\]}\s\\":,]+$/;

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\r/g, '')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*Please retry in [\d.]+s\.?\s*$/i, '')
    .trim();
}

function isUsefulMessage(text: string): boolean {
  const t = text.trim();
  return t.length >= 4 && !GARBAGE_ONLY_RE.test(t);
}

function walkForMessages(value: unknown, depth: number, out: string[]): void {
  if (depth > 12 || value == null) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        walkForMessages(JSON.parse(trimmed), depth + 1, out);
      } catch {
        const snippet = trimmed.match(HUMAN_ERROR_SNIPPET_RE);
        if (snippet?.[0] && isUsefulMessage(snippet[0])) out.push(snippet[0]);
      }
      return;
    }
    const normalized = normalizeWhitespace(value);
    if (isUsefulMessage(normalized)) out.push(normalized);
    return;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail', 'description']) {
      if (key in obj) walkForMessages(obj[key], depth + 1, out);
    }
  }
}

function pickBestMessage(candidates: string[]): string | null {
  const useful = [...new Set(candidates.map(normalizeWhitespace).filter(isUsefulMessage))];
  if (useful.length === 0) return null;
  return useful.sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * Turn raw provider / API error blobs into a single human-readable line for the UI.
 * Handles nested JSON, escaped JSON strings, and provider prefixes like
 * "OpenAI API error: 400 - {...}".
 */
export function formatProviderErrorMessage(raw: unknown): string {
  if (raw == null) return 'Unknown error';
  if (typeof raw !== 'string') {
    if (typeof raw === 'object') {
      const candidates: string[] = [];
      walkForMessages(raw, 0, candidates);
      const best = pickBestMessage(candidates);
      if (best) return best;
      try {
        return formatProviderErrorMessage(JSON.stringify(raw));
      } catch {
        return 'Unknown error';
      }
    }
    return String(raw);
  }

  const original = raw.trim();
  if (!original) return 'Unknown error';

  const statusMatch = original.match(PROVIDER_PREFIX_RE);
  const statusCode = statusMatch?.[1] ?? statusMatch?.[2];
  const body = statusMatch ? original.slice(statusMatch[0].length).trim() : original;

  const candidates: string[] = [];
  const snippet = body.match(HUMAN_ERROR_SNIPPET_RE) ?? original.match(HUMAN_ERROR_SNIPPET_RE);
  if (snippet?.[0]) candidates.push(snippet[0]);

  walkForMessages(body, 0, candidates);

  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      walkForMessages(JSON.parse(body), 0, candidates);
    } catch {
      // Truncated JSON bodies still yield snippet / walk matches above.
    }
  }

  let message = pickBestMessage(candidates);
  if (!message) {
    message = statusCode
      ? `API request failed (${statusCode})`
      : 'API request failed';
  }

  if (message.length > 600) {
    message = `${message.slice(0, 597)}…`;
  }

  if (statusCode && !/^api\s+error/i.test(message) && !message.includes(`(${statusCode})`)) {
    return `API error (${statusCode}): ${message}`;
  }

  return message;
}
