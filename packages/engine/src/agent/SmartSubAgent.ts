import type { AgentXConfig, ToolResult } from '@agentx/shared';
import { generateId, getLogger } from '@agentx/shared';
import { Agent } from './Agent.js';
import { AgentEventBus } from '../EventBus.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { randomUUID } from 'node:crypto';

const logger = getLogger();

export interface SmartSubAgentOptions {
  parentAgent: Agent;
  instruction: string;
  tools?: string[]; // Tool IDs to allow (if empty, all tools)
  timeout?: number;
  readonlyMemory?: boolean; // If true, can read parent memories but not write
  config?: Partial<AgentXConfig>;
  sessionId?: string;
}

export interface SmartSubAgentResult {
  success: boolean;
  output: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: ToolResult; elapsed: number }>;
  elapsed: number;
  tokenUsage: { input: number; output: number };
}

/**
 * A true sub-agent with full Agent capabilities — own tool loop, memory, and event stream.
 * Reports back to parent agent via callback.
 */
export class SmartSubAgent {
  private parentAgent: Agent;
  private instruction: string;
  private allowedTools: string[];
  private timeout: number;
  private config: AgentXConfig;
  private sessionId: string;
  private abortController = new AbortController();
  private toolCallsLog: Array<{ name: string; args: Record<string, unknown>; result: ToolResult; elapsed: number }> = [];
  private startTime = 0;

  constructor(options: SmartSubAgentOptions) {
    this.parentAgent = options.parentAgent;

    // Prepend session context to instruction so sub-agents understand the bigger picture
    const parentCtx = (options.parentAgent as any).buildAgenticContext?.() || '';
    this.instruction = parentCtx
      ? `${parentCtx}\n\n[TASK]\n${options.instruction}`
      : options.instruction;

    this.allowedTools = options.tools ? this.deriveAllowedTools(options.tools) : [];
    this.timeout = options.timeout ?? 120_000;

    const parentConfig = (options.parentAgent as unknown as { config: AgentXConfig }).config;
    this.config = options.config ? { ...parentConfig, ...options.config } : parentConfig;
    this.sessionId = options.sessionId ?? `sub-${generateId()}`;
  }

  /**
   * Execute the sub-agent mission. Creates a full Agent instance and runs it.
   */
  async execute(): Promise<SmartSubAgentResult> {
    this.startTime = Date.now();
    const subEventBus = new AgentEventBus();

    try {
      let toolRegistry: ToolRegistry | undefined;
      let toolExecutor: ToolExecutor | undefined;

      const parentRegistry = (this.parentAgent as unknown as { toolRegistry?: ToolRegistry }).toolRegistry;
      const parentExecutor = (this.parentAgent as unknown as { toolExecutor?: ToolExecutor }).toolExecutor;

      if (parentRegistry && parentExecutor) {
        if (this.allowedTools.length > 0) {
          const { ToolRegistry } = await import('../tools/ToolRegistry.js');
          const { ToolExecutor } = await import('../tools/ToolExecutor.js');
          toolRegistry = new ToolRegistry();
          for (const toolId of this.allowedTools) {
            const def = parentRegistry.get(toolId);
            if (def) toolRegistry.register(def);
          }
          toolExecutor = new ToolExecutor(
            toolRegistry,
            (parentExecutor as unknown as { scopePath?: string }).scopePath!,
          );
        } else {
          toolRegistry = parentRegistry;
          toolExecutor = parentExecutor;
        }
      }

      this.parentAgent.createChildSession(this.sessionId);

      const subAgent = new Agent({
        config: this.config,
        sessionId: this.sessionId,
        systemPrompt: this.buildSubAgentPrompt(),
        toolRegistry,
        toolExecutor,
        eventBus: subEventBus,
      });

      // Wire up session-based persistence so the child session is replayable
      const sessionManager = (this.parentAgent as unknown as { sessionManager?: { store?: { insertMessage?: (msg: Record<string, unknown>) => void; insertPart?: (sid: string, part: Record<string, unknown>) => void } } }).sessionManager;
      const childStore = sessionManager?.store;

      // Persist tool parts in real-time as the child agent runs, and forward to parent UI
      subEventBus.on((event) => {
        const evType = (event as { type?: string }).type ?? '';

        // Persist tool-call and tool-result parts to child session's SQLite store
        if (childStore?.insertPart) {
          if (evType === 'tool_executing') {
            const toolName = ((event as any).tool as string) ?? '';
            const toolCallId = (event as any).callId as string || (event as any).toolCallId as string || randomUUID();
            const toolArgs = (event as any).args as Record<string, unknown> | undefined;
            childStore.insertPart(this.sessionId, { type: 'tool-call', toolName, toolCallId, toolArgs });
          }
          if (evType === 'tool_complete') {
            const toolName = ((event as any).tool as string) ?? '';
            const toolCallId = (event as any).callId as string || (event as any).toolCallId as string || '';
            const result = (event as any).result ?? (event as any).output as string ?? '';
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result ?? '');
            childStore.insertPart(this.sessionId, { type: 'tool-result', toolName, toolCallId, toolResult: resultStr, toolSuccess: true });
          }
        }

        // Forward events to parent (for UI visibility)
        this.parentAgent.events.emit({
          type: 'subagent_event',
          subagentId: this.sessionId,
          parentEvent: event,
        });
      });

      const timeoutId = setTimeout(() => {
        this.abortController.abort();
      }, this.timeout);

      const result = await subAgent.sendMessage(this.instruction);

      clearTimeout(timeoutId);

      // Persist all child session messages so the restore endpoint can replay them
      if (childStore?.insertMessage) {
        const messages = subAgent.getMessageHistory();
        for (const msg of messages) {
          if (msg.role === 'system') continue;
          childStore.insertMessage({
            sessionId: this.sessionId,
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            toolCalls: (msg as any).toolCalls,
            tokenCount: (msg as any).tokenCount,
          });
        }
      }

      const subTracker = (subAgent as unknown as { tokenTracker?: { inputTokenCount: number; outputTokenCount: number } }).tokenTracker;
      const tokenUsage = {
        input: subTracker?.inputTokenCount ?? 0,
        output: subTracker?.outputTokenCount ?? 0,
      };

      return {
        success: true,
        output: result.content,
        toolCalls: this.toolCallsLog,
        elapsed: Date.now() - this.startTime,
        tokenUsage,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Sub-agent failed';
      logger.error('SMART_SUBAGENT', msg);
      return {
        success: false,
        output: msg,
        toolCalls: this.toolCallsLog,
        elapsed: Date.now() - this.startTime,
        tokenUsage: { input: 0, output: 0 },
      };
    }
  }

  /**
   * Build a specialized system prompt for the sub-agent.
   */
  private deriveAllowedTools(requestedTools: string[]): string[] {
    // Sub-agents cannot spawn further sub-agents or manage todos/tasks
    const deniedTools = new Set(['delegate_to_subagent', 'sub_agent_spawn', 'todowrite', 'todo_delete']);
    return requestedTools.filter(t => !deniedTools.has(t));
  }

  private buildSubAgentPrompt(): string {
    const restrictedNote = `\nIMPORTANT: You cannot delegate to sub-agents or manage tasks.`;
    return `[MISSION]
Focus ONLY on completing the assigned task.

Rules:
1. Do NOT greet the user or ask unnecessary questions.
2. Use tools aggressively to complete the task.
3. If you encounter errors, try alternative approaches.
4. Return a CONCISE summary of what you did and the final result.
${restrictedNote}

${this.allowedTools.length > 0 ? `Available tools: ${this.allowedTools.join(', ')}` : 'All tools available.'}
[/MISSION]`;
  }
}
