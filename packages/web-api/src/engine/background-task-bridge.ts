/**
 * Background Task Event Bridge
 *
 * When a user navigates away from a session that has running background
 * sub-agents, `destroyAgent()` unsubscribes the WS subscriber from the
 * agent's event bus. The background tasks continue running on the OLD
 * agent's event bus, but the new agent (created when the user returns)
 * has a different event bus.
 *
 * This bridge maintains a registry of "orphaned" event buses (from agents
 * with running background tasks) and forwards relevant events to any
 * new agent that subscribes for the same session.
 *
 * Forwarded event types:
 * - background_task_complete
 * - agent_progress
 * - agent_complete
 * - subagent_event
 */

import type { EngineEvent, EventHandler } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import type { AgentEventBus } from '@agentx/engine';

const logger = getLogger();

interface BridgeEntry {
  /** The old agent's event bus — still receiving events from running background tasks. */
  eventBus: AgentEventBus;
  /** Unsubscribe function for the bridge's own listener on the old bus. */
  unsubscribe: () => void;
  /** Set of forwarded event types. */
  forwardedTypes: Set<string>;
  /** Timestamp when the entry was created (for debugging/cleanup). */
  registeredAt: number;
}

/** Map of parentSessionId → BridgeEntry */
const bridgeRegistry = new Map<string, BridgeEntry>();

/** Event types that should be forwarded from old to new agent event buses. */
const FORWARDABLE_EVENT_TYPES = new Set<string>([
  'background_task_complete',
  'agent_progress',
  'agent_complete',
  'subagent_event',
  'task_backgrounded',
]);

/**
 * Register an orphaned event bus for a session. Called by `destroyAgent()`
 * when the agent being destroyed has running background sub-agents.
 *
 * @param sessionId The parent session ID
 * @param eventBus The old agent's event bus (still receiving background task events)
 */
export function registerOrphanedEventBus(sessionId: string, eventBus: AgentEventBus): void {
  // If there's an existing entry, keep it — the old bus is still alive
  if (bridgeRegistry.has(sessionId)) {
    logger.debug('BG_BRIDGE', `Session ${sessionId.slice(0, 8)} already has an orphaned event bus — keeping existing`);
    return;
  }

  // We don't add a listener here — we only forward when a new agent subscribes.
  // The entry just keeps a reference to the event bus so it doesn't get GC'd.
  const entry: BridgeEntry = {
    eventBus,
    unsubscribe: () => {},
    forwardedTypes: FORWARDABLE_EVENT_TYPES,
    registeredAt: Date.now(),
  };
  bridgeRegistry.set(sessionId, entry);
  logger.info('BG_BRIDGE', `Registered orphaned event bus for session ${sessionId.slice(0, 8)}`);
}

/**
 * Connect a new agent's event bus to any orphaned event bus for the same session.
 * Called by `createAgent()` after the new agent is created.
 *
 * Events from the old bus (background task completions, progress, etc.) will be
 * re-emitted on the new agent's event bus so the WS subscriber can stream them.
 *
 * @param sessionId The parent session ID
 * @param newEventBus The new agent's event bus
 * @returns An unsubscribe function (call when the new agent is destroyed)
 */
export function connectToOrphanedBus(sessionId: string, newEventBus: AgentEventBus): () => void {
  const entry = bridgeRegistry.get(sessionId);
  if (!entry) return () => {};

  // Forward events from the old bus to the new bus
  const forwardHandler: EventHandler = (event: EngineEvent) => {
    const evType = (event as { type?: string }).type ?? '';
    if (entry.forwardedTypes.has(evType)) {
      try {
        newEventBus.emit(event);
        logger.debug('BG_BRIDGE', `Forwarded ${evType} from orphaned bus to new bus for session ${sessionId.slice(0, 8)}`);
      } catch (err) {
        logger.warn('BG_BRIDGE', `Failed to forward ${evType}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const unsub = entry.eventBus.on(forwardHandler);
  entry.unsubscribe = unsub;

  logger.info('BG_BRIDGE', `Connected new event bus to orphaned bus for session ${sessionId.slice(0, 8)}`);
  return () => {
    unsub();
    entry.unsubscribe = () => {};
  };
}

/**
 * Unregister an orphaned event bus. Called when all background tasks for a
 * session have completed (or when the session is deleted).
 *
 * @param sessionId The parent session ID
 */
export function unregisterOrphanedEventBus(sessionId: string): void {
  const entry = bridgeRegistry.get(sessionId);
  if (!entry) return;
  entry.unsubscribe();
  bridgeRegistry.delete(sessionId);
  logger.info('BG_BRIDGE', `Unregistered orphaned event bus for session ${sessionId.slice(0, 8)}`);
}

/**
 * Check if a session has an orphaned event bus (i.e., running background tasks
 * from a previous agent instance).
 */
export function hasOrphanedEventBus(sessionId: string): boolean {
  return bridgeRegistry.has(sessionId);
}

/**
 * Get all session IDs that have orphaned event buses.
 * Useful for cleanup on shutdown.
 */
export function getOrphanedSessionIds(): string[] {
  return [...bridgeRegistry.keys()];
}

/**
 * Clean up all orphaned event buses. Called on shutdown.
 */
export function clearAllOrphanedBuses(): void {
  for (const [sessionId, entry] of bridgeRegistry) {
    entry.unsubscribe();
    logger.debug('BG_BRIDGE', `Cleared orphaned bus for session ${sessionId.slice(0, 8)}`);
  }
  bridgeRegistry.clear();
}
