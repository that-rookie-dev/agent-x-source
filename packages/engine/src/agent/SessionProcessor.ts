import type {
  AgentXStreamEvent,
  UsageInfo,
  FinalAssistantMessage,
  NormalizedToolCall,
  Message,
} from '@agentx/shared';
import { ToolCallStatus } from '@agentx/shared';
import type { EventBus } from '@agentx/shared';
import { LiveProjector } from '../communication/LiveProjector.js';
import { EventBroadcaster } from '../communication/EventBroadcaster.js';

export interface SessionProcessorContext {
  sessionId: string;
  eventBus: EventBus;
  broadcaster: EventBroadcaster;
  projector: LiveProjector;
  onToolCallsReady?: (calls: NormalizedToolCall[]) => Promise<void>;
  onDoomLoopCheck?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => boolean;
}

export interface ProcessedTurn {
  messages: Message[];
  assistantMessage: FinalAssistantMessage;
  toolCalls: NormalizedToolCall[];
  usage: UsageInfo;
}

export class SessionProcessor {
  private pendingToolCalls: Map<string, NormalizedToolCall> = new Map();
  private accumulatedText = '';
  private accumulatedReasoning = '';
  private currentMessageId = '';

  private ctx: SessionProcessorContext;

  constructor(ctx: SessionProcessorContext) {
    this.ctx = ctx;
  }

  async process(
    events: AsyncIterable<AgentXStreamEvent>,
    turnId: string,
  ): Promise<ProcessedTurn> {
    this.reset();

    for await (const event of events) {
      void this.handleEvent(event);
    }

    const assistantMessage = this.buildAssistantMessage();
    const toolCalls = Array.from(this.pendingToolCalls.values());

    return {
      messages: this.buildMessages(turnId, assistantMessage),
      assistantMessage,
      toolCalls,
      usage: assistantMessage.usage,
    };
  }

  private handleEvent(event: AgentXStreamEvent): void {
    switch (event.type) {
      case 'turn.start':
        this.ctx.eventBus.emit({
          type: 'processing_start',
          taskDescription: `Turn ${event.turnId}`,
        });
        break;

      case 'text.start':
        this.currentMessageId = event.messageId;
        break;

      case 'text.delta': {
        this.accumulatedText += event.delta;
        const projected = this.ctx.projector.project(this.accumulatedText);
        this.ctx.eventBus.emit({
          type: 'stream_chunk',
          content: event.delta,
          fullContent: projected,
        });
        this.ctx.broadcaster.broadcastToSession(event, this.ctx.sessionId);
        break;
      }

      case 'text.end':
        this.ctx.eventBus.emit({
          type: 'loading_end',
        });
        break;

      case 'reasoning.start':
        break;

      case 'reasoning.delta':
        this.accumulatedReasoning += event.delta;
        this.ctx.eventBus.emit({
          type: 'reasoning_glimpse',
          text: event.delta,
        });
        break;

      case 'reasoning.end':
        this.ctx.eventBus.emit({
          type: 'reasoning_complete',
        });
        break;

      case 'tool.input.start': {
        const tool: NormalizedToolCall = {
          id: event.toolCallId,
          name: event.toolName,
          arguments: {},
          status: ToolCallStatus.INPUT_DONE,
        };
        this.pendingToolCalls.set(event.toolCallId, tool);

        this.ctx.eventBus.emit({
          type: 'tool_executing',
          tool: event.toolName,
          description: `Calling ${event.toolName}`,
          startTime: Date.now(),
        });
        break;
      }

      case 'tool.input.delta': {
        const tool = this.pendingToolCalls.get(event.toolCallId);
        if (tool) {
          try {
            const partial = JSON.parse(event.delta);
            tool.arguments = { ...tool.arguments, ...partial };
          } catch {
            // Partial JSON — accumulate as string
          }
        }
        break;
      }

      case 'tool.input.end': {
        const tool = this.pendingToolCalls.get(event.toolCallId);
        if (tool) {
          tool.status = ToolCallStatus.COMPLETED;
        }
        break;
      }

      case 'tool.execute.start':
        this.ctx.eventBus.emit({
          type: 'tool_executing',
          tool: event.toolName,
          description: `Executing ${event.toolName}`,
          startTime: event.ts,
        });
        break;

      case 'tool.execute.progress':
        break;

      case 'tool.execute.end': {
        const tool = this.pendingToolCalls.get(event.toolCallId);
        if (tool) {
          tool.durationMs = event.durationMs;
          tool.status = event.ok ? ToolCallStatus.COMPLETED : ToolCallStatus.ERROR;
        }

        this.ctx.eventBus.emit({
          type: 'tool_complete',
          tool: event.toolCallId,
          result: {
            success: event.ok,
            output: '',
          },
          elapsed: event.durationMs,
        });
        break;
      }

      case 'compaction.start':
        this.ctx.eventBus.emit({
          type: 'compaction_start',
          currentTokens: event.currentTokens,
          threshold: event.threshold,
        });
        break;

      case 'compaction.end':
        this.ctx.eventBus.emit({
          type: 'compaction_complete',
          saved: event.tokensSaved,
        });
        break;

      case 'provider.error':
        // Same as turn.error — drain stuck tool timers before surfacing the error.
        for (const [, tool] of this.pendingToolCalls.entries()) {
          if (tool.status === ToolCallStatus.INPUT_DONE) {
            this.ctx.eventBus.emit({
              type: 'tool_complete',
              tool: tool.name,
              result: { success: false, output: event.message ?? 'Provider error' },
              elapsed: 0,
            });
          }
        }
        this.pendingToolCalls.clear();
        this.ctx.eventBus.emit({
          type: 'error',
          code: event.code,
          message: event.message,
          recoverable: true,
        });
        break;

      case 'provider.retry':
        break;

      case 'turn.end':
        this.ctx.eventBus.emit({
          type: 'token_usage',
          totalTokens: event.usage.totalTokens,
          contextWindow: 0,
        });
        break;

      case 'turn.error':
        // Drain any tool calls that were executing when the error occurred.
        // Without this, tool_executing events would never be paired with a
        // tool_complete, leaving the UI timers stuck indefinitely.
        for (const [, tool] of this.pendingToolCalls.entries()) {
          if (tool.status === ToolCallStatus.INPUT_DONE) {
            this.ctx.eventBus.emit({
              type: 'tool_complete',
              tool: tool.name,
              result: { success: false, output: event.message ?? 'Turn failed' },
              elapsed: 0,
            });
          }
        }
        this.pendingToolCalls.clear();
        this.ctx.eventBus.emit({
          type: 'error',
          code: event.code,
          message: event.message,
          recoverable: false,
        });
        break;
    }
  }

  private buildAssistantMessage(): FinalAssistantMessage {
    return {
      messageId: this.currentMessageId || `msg-${Date.now()}`,
      text: this.ctx.projector.getProjectedBuffer() || this.accumulatedText,
      reasoning: this.accumulatedReasoning || undefined,
      toolCalls: Array.from(this.pendingToolCalls.values()),
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      stopReason: 'end_turn',
    };
  }

  private buildMessages(
    turnId: string,
    assistant: FinalAssistantMessage,
  ): Message[] {
    const messages: Message[] = [];

    messages.push({
      id: `${turnId}-assistant`,
      sessionId: this.ctx.sessionId,
      role: 'assistant',
      content: assistant.text,
      toolCalls: assistant.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
        result: tc.result,
      })),
      tokenCount: assistant.usage.totalTokens ?? 0,
      createdAt: new Date().toISOString(),
      reasoning: assistant.reasoning,
      turnId,
    });

    return messages;
  }

  private reset(): void {
    this.pendingToolCalls.clear();
    this.accumulatedText = '';
    this.accumulatedReasoning = '';
    this.currentMessageId = '';
    this.ctx.projector.reset();
  }
}
