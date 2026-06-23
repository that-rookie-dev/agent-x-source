import type { EngineEvent } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';
import { getLogger } from '@agentx/shared';
import { randomUUID } from 'node:crypto';

const logger = getLogger();

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  topic: string;
  payload: Record<string, unknown>;
  timestamp: number;
  replyTo?: string;
}

export interface AgentSubscription {
  agentId: string;
  topic: string;
  handler: (msg: AgentMessage) => void | Promise<void>;
}

/**
 * Pub/sub message bus for inter-agent communication.
 * Agents discover each other, publish on topics, and subscribe to receive.
 */
export class AgentBus {
  private subscriptions: AgentSubscription[] = [];
  private messageLog: AgentMessage[] = [];
  private agentCapabilities: Map<string, string[]> = new Map();
  private eventBus: AgentEventBus | null = null;

  attachEventBus(bus: AgentEventBus): void {
    this.eventBus = bus;
  }

  /**
   * Register an agent's capabilities for discovery.
   */
  registerAgent(agentId: string, capabilities: string[]): void {
    this.agentCapabilities.set(agentId, capabilities);
    logger.info('AGENT_BUS', `Registered agent ${agentId} with capabilities: ${capabilities.join(', ')}`);
  }

  unregisterAgent(agentId: string): void {
    this.agentCapabilities.delete(agentId);
    this.subscriptions = this.subscriptions.filter((s) => s.agentId !== agentId);
  }

  /**
   * Find agents by capability (specialty).
   */
  findAgents(capability: string): string[] {
    return [...this.agentCapabilities.entries()]
      .filter(([, caps]) => caps.includes(capability))
      .map(([id]) => id);
  }

  listCapabilities(): Map<string, string[]> {
    return new Map(this.agentCapabilities);
  }

  /**
   * Subscribe to messages on a topic.
   */
  subscribe(agentId: string, topic: string, handler: (msg: AgentMessage) => void | Promise<void>): () => void {
    const sub: AgentSubscription = { agentId, topic, handler };
    this.subscriptions.push(sub);
    return () => {
      this.subscriptions = this.subscriptions.filter((s) => s !== sub);
    };
  }

  /**
   * Publish a message to a topic. All subscribers receive it.
   */
  async publish(
    from: string,
    to: string,
    topic: string,
    payload: Record<string, unknown>,
    replyTo?: string,
  ): Promise<AgentMessage> {
    const msg: AgentMessage = {
      id: randomUUID(),
      from,
      to,
      topic,
      payload,
      timestamp: Date.now(),
      replyTo,
    };

    this.messageLog.push(msg);
    if (this.messageLog.length > 500) this.messageLog.shift();

    const subscribers = this.subscriptions.filter(
      (s) => s.topic === topic || s.topic === '*',
    );

    for (const sub of subscribers) {
      try {
        await sub.handler(msg);
      } catch (e) {
        logger.warn('AGENT_BUS', `Handler for ${sub.agentId} on ${topic} failed: ${e}`);
      }
    }

    this.eventBus?.emit({
      type: 'agent_message',
      message: msg,
    } as unknown as EngineEvent);

    return msg;
  }

  /**
   * Wait for a reply to a specific message.
   */
  waitForReply(messageId: string, timeout = 30000): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`No reply to ${messageId} within ${timeout}ms`));
      }, timeout);

      const unsubscribe = this.subscribe('__reply_waiter__', messageId, (msg) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(msg);
      });
    });
  }

  /**
   * Publish a message and wait for a reply.
   */
  async requestReply(
    from: string,
    to: string,
    topic: string,
    payload: Record<string, unknown>,
    timeout = 30000,
  ): Promise<AgentMessage> {
    const msg = await this.publish(from, to, topic, payload);
    return this.waitForReply(msg.id, timeout);
  }

  getMessageHistory(topic?: string): AgentMessage[] {
    if (topic) return this.messageLog.filter((m) => m.topic === topic);
    return [...this.messageLog];
  }

  /**
   * Remove subscriptions for agents that are no longer registered.
   * Call periodically to prevent stale subscription leaks.
   */
  pruneStaleSubscriptions(): number {
    const before = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter((s) => this.agentCapabilities.has(s.agentId));
    const removed = before - this.subscriptions.length;
    if (removed > 0) {
      logger.info('AGENT_BUS', `Pruned ${removed} stale subscription(s)`);
    }
    return removed;
  }

  get subscriptionCount(): number {
    return this.subscriptions.length;
  }
}

/** Singleton agent bus instance */
let globalBus: AgentBus | null = null;

export function getAgentBus(): AgentBus {
  if (!globalBus) globalBus = new AgentBus();
  return globalBus;
}

export function setAgentBus(bus: AgentBus): void {
  globalBus = bus;
}
