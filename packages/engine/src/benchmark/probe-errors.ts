function extractJsonMessage(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const tryParse = (candidate: string): string | null => {
    try {
      const json = JSON.parse(candidate) as Record<string, unknown>;
      const err = json.error;
      if (typeof err === 'object' && err && 'message' in err) {
        const message = (err as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message.trim();
      }
      if (typeof err === 'string' && err.trim()) return err.trim();
      if (typeof json.message === 'string' && json.message.trim()) return json.message.trim();
      if (typeof json.detail === 'string' && json.detail.trim()) return json.detail.trim();
    } catch {
      const match = candidate.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (match?.[1]) return match[1].replace(/\\"/g, '"').trim();
    }
    return null;
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const brace = trimmed.indexOf('{');
  if (brace >= 0) {
    const nested = tryParse(trimmed.slice(brace));
    if (nested) return nested;
  }

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && trimmed.length <= 240) {
    return trimmed;
  }

  return null;
}

function cleanWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function channelFallback(channel: string, lower: string): string | null {
  if (lower.includes('does not support') || lower.includes('unsupported') || lower.includes('not support')) {
    return `${channel} input is not supported by this model or provider`;
  }
  if (lower.includes('audio')) return 'Audio input is not available for this model';
  if (lower.includes('video')) return 'Video input is not available for this model';
  if (lower.includes('image') && (lower.includes('invalid') || lower.includes('unsupported'))) {
    return 'Image input was rejected by the provider';
  }
  if (lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('authentication')) {
    return 'API authentication failed — check provider credentials';
  }
  if (lower.includes('model_not_found') || lower.includes('model not found')) {
    return 'Model not found on this provider';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Provider rate limit reached during the probe';
  }
  return null;
}

/** Strip HTTP status codes and JSON error payloads from provider probe failures. */
export function humanizeProbeError(channel: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutStatus = raw.replace(/^\d{3}\s*:\s*/, '').trim();
  const extracted = extractJsonMessage(withoutStatus) ?? extractJsonMessage(raw);
  const candidate = cleanWhitespace(extracted ?? withoutStatus);
  const lower = candidate.toLowerCase();

  const fallback = channelFallback(channel, lower);
  if (fallback) return fallback;

  if (!candidate || candidate.startsWith('{') || candidate.startsWith('[')) {
    return `${channel} probe failed — the provider did not accept this modality`;
  }

  return candidate.slice(0, 240);
}

export function humanizeHttpError(status: number, body: string): Error {
  const channel = 'API';
  const message = humanizeProbeError(channel, `${status}: ${body}`);
  if (status === 401 || status === 403) {
    return new Error(message.includes('authentication') ? message : 'API authentication failed — check provider credentials');
  }
  if (status === 404) {
    return new Error(message.includes('not found') ? message : 'Model or endpoint not found on this provider');
  }
  if (status === 429) {
    return new Error('Provider rate limit reached during the probe');
  }
  return new Error(message);
}
