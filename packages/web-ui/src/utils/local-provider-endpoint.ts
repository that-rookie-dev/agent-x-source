/** Defaults and URL helpers for local LLM providers (Ollama, LM Studio). */

export function defaultLocalPort(providerId: string): string {
  if (providerId === 'lmstudio') return '1234';
  if (providerId === 'ollama') return '11434';
  return '11434';
}

/** Build the provider base URL from host + port. LM Studio uses OpenAI-compat `/v1`. */
export function buildLocalBaseUrl(providerId: string, host: string, port: string): string {
  const h = (host.trim() || 'localhost').replace(/\/+$/, '');
  const p = (port.trim() || defaultLocalPort(providerId)).replace(/^:/, '');
  if (providerId === 'lmstudio') return `http://${h}:${p}/v1`;
  return `http://${h}:${p}`;
}

export function parseLocalEndpoint(
  baseUrl: string | undefined,
  providerId: string,
): { host: string; port: string } {
  const fallback = { host: 'localhost', port: defaultLocalPort(providerId) };
  if (!baseUrl?.trim()) return fallback;
  try {
    const raw = baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`;
    const u = new URL(raw);
    return {
      host: u.hostname || 'localhost',
      port: u.port || defaultLocalPort(providerId),
    };
  } catch {
    return fallback;
  }
}
