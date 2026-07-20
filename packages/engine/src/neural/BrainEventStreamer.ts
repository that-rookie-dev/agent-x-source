/**
 * Brain Event Streaming
 *
 * Coalesced event bus for the Neural Cortex visualization:
 * - NODE_CREATED:      a neuron was committed to the fabric
 * - SYNAPSE_CONNECTED: an edge was forged between neurons
 * - NEURON_ACTIVATED:  neurons were touched during recall (RAG / search)
 *
 * Events are batched (default 100ms window) so bursts — e.g. a document ingest
 * creating dozens of nodes, or a graph walk touching many neurons — reach the
 * client as a handful of flushes instead of a stampede.
 */
import type { MemoryNodeCategory, MemoryEdgeType } from './MemoryFabric.js';

export interface NodeCreatedEvent {
  event: 'NODE_CREATED';
  nodeId: string;
  label: string;
  category: MemoryNodeCategory;
  x: number | null;
  y: number | null;
  communityId?: string | null;
  sourceId?: string | null;
  sessionId?: string | null;
  timestamp: string;
}

export interface SynapseConnectedEvent {
  event: 'SYNAPSE_CONNECTED';
  sourceId: string;
  targetId: string;
  relationshipType: MemoryEdgeType;
  weight: number;
  timestamp: string;
}

export interface NeuronActivatedEvent {
  event: 'NEURON_ACTIVATED';
  nodeIds: string[];
  intensity: number;
  timestamp: string;
}

export type BrainEvent = NodeCreatedEvent | SynapseConnectedEvent | NeuronActivatedEvent;

export interface BrainEventListener {
  (events: BrainEvent[]): void;
}

/**
 * Event bus for brain visualization events. Listeners receive coalesced
 * batches, never individual events.
 */
export class BrainEventStreamer {
  private listeners: Set<BrainEventListener> = new Set();
  private eventQueue: BrainEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Activated node ids accumulated within the current coalescing window. */
  private pendingActivations: Set<string> = new Set();
  private pendingActivationIntensity = 0;
  private readonly coalesceMs: number;
  private readonly maxBatchSize: number;

  constructor(options: { coalesceMs?: number; maxBatchSize?: number } = {}) {
    this.coalesceMs = options.coalesceMs ?? 100;
    this.maxBatchSize = options.maxBatchSize ?? 100;
  }

  /** Register a batch listener. Returns an unsubscribe function. */
  on(listener: BrainEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  emitNodeCreated(params: Omit<NodeCreatedEvent, 'event' | 'timestamp'>): void {
    if (this.listeners.size === 0) return;
    this.enqueue({ event: 'NODE_CREATED', ...params, timestamp: new Date().toISOString() });
  }

  emitSynapseConnected(params: Omit<SynapseConnectedEvent, 'event' | 'timestamp'>): void {
    if (this.listeners.size === 0) return;
    this.enqueue({ event: 'SYNAPSE_CONNECTED', ...params, timestamp: new Date().toISOString() });
  }

  /**
   * Activations are merged within a coalescing window: a recall pass that
   * fires 20 neurons produces a single NEURON_ACTIVATED event.
   */
  emitNeuronActivated(params: { nodeIds: string[]; intensity?: number }): void {
    if (this.listeners.size === 0 || params.nodeIds.length === 0) return;
    for (const id of params.nodeIds) this.pendingActivations.add(id);
    this.pendingActivationIntensity = Math.max(this.pendingActivationIntensity, params.intensity ?? 1.0);
    this.scheduleFlush();
  }

  private enqueue(event: BrainEvent): void {
    this.eventQueue.push(event);
    if (this.eventQueue.length >= this.maxBatchSize) {
      this.flush();
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.coalesceMs);
      // Never keep the process alive just for visualization events.
      this.flushTimer.unref?.();
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const events = this.eventQueue;
    this.eventQueue = [];

    if (this.pendingActivations.size > 0) {
      events.push({
        event: 'NEURON_ACTIVATED',
        nodeIds: Array.from(this.pendingActivations),
        intensity: this.pendingActivationIntensity || 1.0,
        timestamp: new Date().toISOString(),
      });
      this.pendingActivations.clear();
      this.pendingActivationIntensity = 0;
    }

    if (events.length === 0) return;

    for (const listener of this.listeners) {
      try {
        listener(events);
      } catch (err) {
        console.error('Brain event listener error:', err);
      }
    }
  }

  /** Force immediate flush of all queued events. */
  forceFlush(): void {
    this.flush();
  }

  /** Clear all listeners and pending state. */
  clear(): void {
    this.listeners.clear();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.eventQueue = [];
    this.pendingActivations.clear();
    this.pendingActivationIntensity = 0;
  }
}

// ── Global singleton ─────────────────────────────────────────────────
let globalStreamer: BrainEventStreamer | null = null;

export function getGlobalBrainEventStreamer(): BrainEventStreamer {
  if (!globalStreamer) {
    globalStreamer = new BrainEventStreamer();
  }
  return globalStreamer;
}

export function setGlobalBrainEventStreamer(streamer: BrainEventStreamer): void {
  globalStreamer = streamer;
}
