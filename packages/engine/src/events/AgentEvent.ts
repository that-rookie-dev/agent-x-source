import type { EngineEvent } from '@agentx/shared';

/**
 * Union of all runtime events emitted by the agent runtime.
 *
 * This is a thin alias for the shared EngineEvent union so the engine
 * events package is the canonical place to import runtime events from.
 */
export type AgentEvent = EngineEvent;

export type { EngineEvent };
