/**
 * Document Studio — typed event bus for MCP/agent and HTTP SSE consumers.
 *
 * Emits: `master.analysis`, `job.progress`, `job.gate`, `artifact.ready`.
 */

import type { Master, Job, Artifact } from '../types.js';

export interface DocumentStudioEventPayloads {
  'master.analysis': { type: 'master.analysis'; master: Master; timestamp: string };
  'job.progress': { type: 'job.progress'; job: Job; timestamp: string };
  'job.gate': { type: 'job.gate'; job: Job; gate: string; timestamp: string };
  'artifact.ready': { type: 'artifact.ready'; artifact: Artifact; jobId: string; timestamp: string };
}

export type DocumentStudioEventName = keyof DocumentStudioEventPayloads;
export type DocumentStudioEvent = DocumentStudioEventPayloads[DocumentStudioEventName];

export const DOCUMENT_STUDIO_EVENT_NAMES: DocumentStudioEventName[] = [
  'master.analysis',
  'job.progress',
  'job.gate',
  'artifact.ready',
];

export type DocumentStudioEventListener<T extends DocumentStudioEventName> = (
  payload: DocumentStudioEventPayloads[T],
) => void;

export class DocumentStudioEventBus {
  private readonly listeners: Map<
    DocumentStudioEventName,
    Set<DocumentStudioEventListener<DocumentStudioEventName>>
  > = new Map();

  on<T extends DocumentStudioEventName>(
    event: T,
    listener: DocumentStudioEventListener<T>,
  ): () => void {
    const set = this.listeners.get(event) ?? new Set<DocumentStudioEventListener<DocumentStudioEventName>>();
    this.listeners.set(event, set);
    const generic = listener as DocumentStudioEventListener<DocumentStudioEventName>;
    set.add(generic);
    return () => {
      set.delete(generic);
      if (set.size === 0) this.listeners.delete(event);
    };
  }

  off<T extends DocumentStudioEventName>(
    event: T,
    listener: DocumentStudioEventListener<T>,
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as DocumentStudioEventListener<DocumentStudioEventName>);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit<T extends DocumentStudioEventName>(
    event: T,
    payload: DocumentStudioEventPayloads[T],
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        /* listener errors must not break the bus */
      }
    }
  }

  /**
   * Subscribe to every Document Studio event. Returns an unsubscribe function.
   */
  subscribe(listener: (event: DocumentStudioEvent) => void): () => void {
    const unsubs: (() => void)[] = [];
    for (const name of DOCUMENT_STUDIO_EVENT_NAMES) {
      unsubs.push(this.on(name, listener as DocumentStudioEventListener<typeof name>));
    }
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }

  /** Number of currently registered listeners (handy for tests). */
  listenerCount(event?: DocumentStudioEventName): number {
    if (event) return this.listeners.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

/** Application-wide Document Studio event bus. */
export const documentStudioEventBus = new DocumentStudioEventBus();

/** Serialize an event to SSE `data:` lines with a trailing blank newline. */
export function formatSseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
