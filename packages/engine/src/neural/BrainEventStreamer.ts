/**
 * Brain Event Streaming Protocol
 * 
 * Implements the visualization event streaming protocol from NEURAL_BRAIN_STRUCTURING.md:
 * - NODE_CREATED: When a neuron is committed to the database
 * - SYNAPSE_CONNECTED: When an edge is forged between nodes
 * - NEURON_ACTIVATED: When nodes are queried/traversed during RAG
 */

export interface NodeCreatedEvent {
  event: 'NODE_CREATED';
  node_id: string;
  cluster_id: string;
  type: 'Concept' | 'Attribute' | 'Operation' | 'State' | 'Session';
  label: string;
  content?: string;
  x?: number | null;
  y?: number | null;
  sourceColor?: string;
  timestamp: string;
}

export interface SynapseConnectedEvent {
  event: 'SYNAPSE_CONNECTED';
  source_id: string;
  target_id: string;
  edge_type: 'PARENT_OF' | 'DEPENDS_ON' | 'MODIFIES' | 'RESONATES_WITH';
  weight: number;
  timestamp: string;
}

export interface NeuronActivatedEvent {
  event: 'NEURON_ACTIVATED';
  node_ids: string[];
  intensity: number;
  timestamp: string;
}

export type BrainEvent = NodeCreatedEvent | SynapseConnectedEvent | NeuronActivatedEvent;

export interface BrainEventListener {
  (event: BrainEvent): void | Promise<void>;
}

/**
 * Event bus for brain visualization events
 */
export class BrainEventStreamer {
  private listeners: Set<BrainEventListener> = new Set();
  private eventQueue: BrainEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly coalesceMs: number;
  private readonly maxBatchSize: number;

  constructor(options: { coalesceMs?: number; maxBatchSize?: number } = {}) {
    this.coalesceMs = options.coalesceMs ?? 100;
    this.maxBatchSize = options.maxBatchSize ?? 100;
  }

  /**
   * Register an event listener
   */
  on(listener: BrainEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit a NODE_CREATED event
   */
  emitNodeCreated(params: {
    nodeId: string;
    clusterId: string;
    type: 'Concept' | 'Attribute' | 'Operation' | 'State' | 'Session';
    label: string;
    content?: string;
    x?: number | null;
    y?: number | null;
    sourceColor?: string;
  }): void {
    const event: NodeCreatedEvent = {
      event: 'NODE_CREATED',
      node_id: params.nodeId,
      cluster_id: params.clusterId,
      type: params.type,
      label: params.label,
      content: params.content,
      x: params.x,
      y: params.y,
      sourceColor: params.sourceColor,
      timestamp: new Date().toISOString(),
    };

    this.enqueue(event);
  }

  /**
   * Emit a SYNAPSE_CONNECTED event
   */
  emitSynapseConnected(params: {
    sourceId: string;
    targetId: string;
    edgeType: 'PARENT_OF' | 'DEPENDS_ON' | 'MODIFIES' | 'RESONATES_WITH';
    weight: number;
  }): void {
    const event: SynapseConnectedEvent = {
      event: 'SYNAPSE_CONNECTED',
      source_id: params.sourceId,
      target_id: params.targetId,
      edge_type: params.edgeType,
      weight: params.weight,
      timestamp: new Date().toISOString(),
    };

    this.enqueue(event);
  }

  /**
   * Emit a NEURON_ACTIVATED event
   */
  emitNeuronActivated(params: {
    nodeIds: string[];
    intensity?: number;
  }): void {
    const event: NeuronActivatedEvent = {
      event: 'NEURON_ACTIVATED',
      node_ids: params.nodeIds,
      intensity: params.intensity ?? 1.0,
      timestamp: new Date().toISOString(),
    };

    this.enqueue(event);
  }

  /**
   * Enqueue an event for batched delivery
   */
  private enqueue(event: BrainEvent): void {
    this.eventQueue.push(event);

    // Flush immediately if batch size exceeded
    if (this.eventQueue.length >= this.maxBatchSize) {
      this.flush();
      return;
    }

    // Schedule a flush if not already scheduled
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.coalesceMs);
    }
  }

  /**
   * Flush queued events to all listeners
   */
  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    // Broadcast to all listeners
    this.listeners.forEach(listener => {
      try {
        events.forEach(event => listener(event));
      } catch (err) {
        console.error('Brain event listener error:', err);
      }
    });
  }

  /**
   * Force immediate flush of all queued events
   */
  forceFlush(): void {
    this.flush();
  }

  /**
   * Clear all listeners
   */
  clear(): void {
    this.listeners.clear();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.eventQueue = [];
  }
}

/**
 * Global singleton instance
 */
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
