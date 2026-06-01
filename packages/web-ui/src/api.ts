import type { ChatMessage, StreamEvent } from './types';

const API_BASE = '/api';

let sessionId: string | null = null;

export async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/sessions`, { method: 'POST' });
  const data = await res.json() as { sessionId: string };
  sessionId = data.sessionId;
  return sessionId;
}

export async function getSessionHistory(sid: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/sessions/${sid}/messages`);
  if (!res.ok) return [];
  return (await res.json()) as ChatMessage[];
}

export function sendMessage(
  content: string,
  onEvent: (event: StreamEvent) => void,
  onDone: () => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();
  const sid = sessionId ?? 'default';

  fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sid, message: content }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      onError(`HTTP ${res.status}: ${res.statusText}`);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) { onError('No response body'); return; }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') { onDone(); return; }
        try {
          const event = JSON.parse(payload) as StreamEvent;
          onEvent(event);
        } catch { /* skip malformed */ }
      }
    }
    onDone();
  }).catch((err: Error) => {
    if (err.name !== 'AbortError') onError(err.message);
  });

  return controller;
}

export async function cancelGeneration(): Promise<void> {
  if (!sessionId) return;
  await fetch(`${API_BASE}/chat/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}

export function getSessionId(): string | null {
  return sessionId;
}

export function setSessionId(id: string): void {
  sessionId = id;
}
