import { randomUUID } from 'node:crypto';
import type { AgentXConfig, Crew, EngineEvent } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import type { AgentEventBus } from '../EventBus.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import { CrewOrchestrator } from '../agent/CrewOrchestrator.js';
import { createCrewPrivateContextHandler, SessionContextHandler } from '../context/SessionContextHandler.js';

export interface CrewChatServiceDeps {
  sessionId: string;
  crew: Crew;
  scopePath: string;
  provider: ProviderInterface;
  activeModel: string;
  providerId: string;
  eventBus: AgentEventBus;
  sessionManager: SessionManager;
  config: AgentXConfig;
  toolRegistry?: ToolRegistry;
  toolExecutor?: ToolExecutor;
  persistDir?: string;
}

export interface CrewChatTurnResult {
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  elapsed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface CrewChatStreamHandlers {
  onChunk?: (delta: string, fullContent: string) => void;
  onTokenUsage?: (usage: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
}

type MessageStore = {
  insertMessage?: (msg: Record<string, unknown>) => string | void;
  getMessages?: (id: string) => Array<{ role: string; content: string }>;
  deleteLastMessages?: (id: string, count: number, roles?: string[]) => void;
};

/**
 * 1:1 private chat between user and a single crew member.
 * No Agent-X routing — narrative memory via SessionContextHandler (crew_private).
 */
export class CrewChatService {
  readonly sessionId: string;
  readonly crew: Crew;
  private readonly context: SessionContextHandler;
  private readonly orchestrator: CrewOrchestrator;
  private readonly eventBus: AgentEventBus;
  private readonly sessionManager: SessionManager;
  private readonly providerId: string;
  private readonly activeModel: string;
  private processing = false;
  private cancelRequested = false;

  constructor(deps: CrewChatServiceDeps) {
    this.sessionId = deps.sessionId;
    this.crew = deps.crew;
    this.eventBus = deps.eventBus;
    this.sessionManager = deps.sessionManager;
    this.providerId = deps.providerId;
    this.activeModel = deps.activeModel;

    this.context = createCrewPrivateContextHandler({
      sessionId: deps.sessionId,
      crewId: deps.crew.id,
      crewName: deps.crew.name,
      callsign: deps.crew.callsign,
    });
    if (deps.persistDir) {
      this.context.setPersistDir(deps.persistDir);
    }
    this.context.setScopePath(deps.scopePath);

    this.orchestrator = new CrewOrchestrator(deps.provider, deps.eventBus);
    this.orchestrator.setSessionId(deps.sessionId);
    this.orchestrator.setSessionManager(deps.sessionManager);
    this.orchestrator.setActiveModel(deps.activeModel);
    this.orchestrator.setConfig(deps.config);
    if (deps.toolRegistry && deps.toolExecutor) {
      this.orchestrator.setTools(deps.toolRegistry, deps.toolExecutor);
    }
    this.orchestrator.addMember(deps.crew);
  }

  getContextHandler(): SessionContextHandler {
    return this.context;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  cancel(): void {
    this.cancelRequested = true;
  }

  warmFromMessages(messages: Array<{ role: string; content: string }>): number {
    return this.context.rebuildFromMessages(messages);
  }

  private getStore(): MessageStore | undefined {
    return (this.sessionManager as unknown as { store?: MessageStore }).store;
  }

  private emit(event: EngineEvent): void {
    this.eventBus.emit(event);
  }

  private logTokens(inputTokens: number, outputTokens: number, costUsd: number, crewId: string): void {
    try {
      this.sessionManager.addTokenLog({
        sessionId: this.sessionId,
        inputTokens,
        outputTokens,
        model: this.activeModel,
        costUsd,
        providerId: this.providerId,
        crewId,
      });
    } catch { /* best-effort */ }
  }

  private insertMessage(
    role: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): string {
    const id = randomUUID();
    const store = this.getStore();
    const inserted = store?.insertMessage?.({
      id,
      sessionId: this.sessionId,
      role,
      content,
      metadata,
    });
    return typeof inserted === 'string' ? inserted : id;
  }

  private emitTextDelta(delta: string, fullContent: string): void {
    this.emit({
      type: 'text_delta',
      sessionId: this.sessionId,
      sequence: Date.now(),
      timestamp: Date.now(),
      payload: { content: delta, fullContent },
    } as unknown as EngineEvent);
  }

  private buildAssistantMessage(content: string, messageId: string) {
    return {
      id: messageId,
      role: 'assistant' as const,
      content,
      crew: {
        crewId: this.crew.id,
        name: this.crew.name,
        callsign: this.crew.callsign,
        color: this.crew.color,
        icon: this.crew.icon,
      },
    };
  }

  private assertNotCancelled(): void {
    if (this.cancelRequested) throw new Error('crew-chat-cancelled');
  }

  async sendMessage(text: string, handlers?: CrewChatStreamHandlers): Promise<CrewChatTurnResult> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('text-required');
    if (this.processing) throw new Error('crew-chat-busy');
    this.processing = true;
    this.cancelRequested = false;

    const startTime = Date.now();
    let fullContent = '';
    let userMessageId = '';
    try {
      this.assertNotCancelled();
      this.context.recordUser(trimmed);
      userMessageId = this.insertMessage('user', trimmed, {
        crewId: this.crew.id,
        displayHint: 'private',
      });

      this.emit({
        type: 'message_sent',
        message: { id: userMessageId, role: 'user', content: trimmed },
      } as EngineEvent);

      this.emit({
        type: 'crew_activity',
        crewId: this.crew.id,
        crewName: this.crew.name,
        activity: 'thinking',
      } as EngineEvent);

      const narrativeBlock = this.context.getNarrativeBlock();

      const savedTokenLog = this.orchestrator.onTokenLog;
      this.orchestrator.onTokenLog = null;

      const { content, elapsed, inputTokens, outputTokens, costUsd } = await this.orchestrator.respondDirect(
        this.crew.id,
        trimmed,
        narrativeBlock,
        {
          onChunk: (delta) => {
            if (this.cancelRequested) return;
            fullContent += delta;
            this.emitTextDelta(delta, fullContent);
            handlers?.onChunk?.(delta, fullContent);
          },
          shouldAbort: () => this.cancelRequested,
        },
      );

      this.orchestrator.onTokenLog = savedTokenLog;
      this.assertNotCancelled();

      this.context.recordCrew(this.crew.name, content);
      this.logTokens(inputTokens, outputTokens, costUsd, this.crew.id);
      handlers?.onTokenUsage?.({ inputTokens, outputTokens, costUsd });

      const assistantMessageId = this.insertMessage('assistant', content, {
        crewId: this.crew.id,
        crewName: this.crew.name,
        callsign: this.crew.callsign,
      });

      this.emit({
        type: 'message_received',
        message: this.buildAssistantMessage(content, assistantMessageId),
        elapsed: Date.now() - startTime,
      } as EngineEvent);

      this.emit({
        type: 'crew_activity',
        crewId: this.crew.id,
        crewName: this.crew.name,
        activity: 'done',
      } as EngineEvent);

      return {
        userMessageId,
        assistantMessageId,
        content,
        elapsed,
        inputTokens,
        outputTokens,
        costUsd,
      };
    } catch (e) {
      if (this.cancelRequested && userMessageId) {
        try {
          this.getStore()?.deleteLastMessages?.(this.sessionId, 1, ['user']);
        } catch { /* best-effort */ }
      }
      throw e;
    } finally {
      this.processing = false;
      this.cancelRequested = false;
    }
  }

  /** Remove last user+assistant exchange and rebuild narrative — for retry. */
  retryLastTurn(): number {
    const store = this.getStore();
    if (store?.deleteLastMessages) {
      store.deleteLastMessages(this.sessionId, 2, ['user', 'assistant']);
    }
    const msgs = store?.getMessages?.(this.sessionId) ?? [];
    return this.context.rebuildFromMessages(msgs.map((m) => ({ role: m.role, content: m.content })));
  }
}
