import type { AgentXConfig, ToolResult } from '@agentx/shared';
import { generateId, getLogger } from '@agentx/shared';
import { Agent } from './Agent.js';
import { AgentEventBus } from '../EventBus.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';

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

    this.allowedTools = options.tools ?? [];
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
      // Create a filtered tool registry if specific tools requested
      let toolRegistry: ToolRegistry | undefined;
      let toolExecutor: ToolExecutor | undefined;

      const parentRegistry = (this.parentAgent as unknown as { toolRegistry?: ToolRegistry }).toolRegistry;
      const parentExecutor = (this.parentAgent as unknown as { toolExecutor?: ToolExecutor }).toolExecutor;

      if (parentRegistry && parentExecutor) {
        if (this.allowedTools.length > 0) {
          // Clone registry with only allowed tools
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

      // Create sub-agent with custom system prompt, wiring event bus for forwarding
      const subAgent = new Agent({
        config: this.config,
        sessionId: this.sessionId,
        systemPrompt: this.buildSubAgentPrompt(),
        toolRegistry,
        toolExecutor,
        eventBus: subEventBus,
      });

      // Forward events to parent (for UI visibility)
      subEventBus.on((event) => {
        this.parentAgent.events.emit({
          type: 'subagent_event',
          subagentId: this.sessionId,
          parentEvent: event,
        });
      });

      // Set timeout
      const timeoutId = setTimeout(() => {
        this.abortController.abort();
      }, this.timeout);

      // Run the mission
      const result = await subAgent.sendMessage(this.instruction);

      clearTimeout(timeoutId);

      // Track real token usage from sub-agent
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
  private buildSubAgentPrompt(): string {
    return `[SUBAGENT_MISSION]
You are a specialist sub-agent working on a specific mission. Focus ONLY on completing the assigned task.

Rules:
1. Do NOT greet the user or ask unnecessary questions.
2. Use tools aggressively to complete the task.
3. If you encounter errors, try alternative approaches.
4. Return a CONCISE summary of what you did and the final result.
5. Do NOT mention that you are a sub-agent.

${this.allowedTools.length > 0 ? `Available tools: ${this.allowedTools.join(', ')}` : 'All tools available.'}
[/SUBAGENT_MISSION]`;
  }
}
