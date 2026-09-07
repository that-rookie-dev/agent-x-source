const DEFAULT_OLLAMA_ORIGIN = 'http://localhost:11434';

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Origin used by native Ollama (`/api/tags`, `/api/chat`). Strips a trailing `/v1`. */
export function ollamaNativeBaseUrl(baseUrl?: string): string {
  const raw = stripTrailingSlashes((baseUrl ?? DEFAULT_OLLAMA_ORIGIN).trim() || DEFAULT_OLLAMA_ORIGIN);
  return raw.replace(/\/v1$/i, '') || DEFAULT_OLLAMA_ORIGIN;
}

/** OpenAI-compatible root used by the AI SDK (`/v1/chat/completions`). */
export function ollamaOpenAiBaseUrl(baseUrl?: string): string {
  return `${ollamaNativeBaseUrl(baseUrl)}/v1`;
}
