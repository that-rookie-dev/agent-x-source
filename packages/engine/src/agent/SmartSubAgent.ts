import type { AgentXConfig, PermissionRule, ToolResult } from '@agentx/shared';
import { generateSubSessionId, getLogger } from '@agentx/shared';
import { Agent } from './Agent.js';
import type { SessionManager } from '../session/SessionManager.js';
import { AgentEventBus } from '../EventBus.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { EnhancedToolExecutor } from '../tools/EnhancedToolExecutor.js';
import type { CrewMissionContext } from './CrewMissionContext.js';
import type { PartPersistFn } from './AiSdkStreamHandler.js';
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
  /** Override the default sub-agent mission prompt with crew persona, etc. */
  systemPromptOverride?: string;
  displayName?: string;
  crewPermissions?: PermissionRule[];
  missionContext?: CrewMissionContext;
  childSessionKind?: 'sub_agent' | 'crew_worker';
  /** Inbound channel context captured at spawn time — propagated to the child tool executor. */
  inboundChannel?: string;
  inboundThreadId?: string;
  inboundMessageId?: string;
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
  private config: AgentXConfig;
  private sessionId: string;
  private systemPromptOverride?: string;
  private crewPermissions: PermissionRule[];
  private missionContext?: CrewMissionContext;
  private displayName?: string;
  private childSessionKind: 'sub_agent' | 'crew_worker';
  private inboundChannel?: string;
  private inboundThreadId?: string;
  private inboundMessageId?: string;
  private toolCallsLog: Array<{ name: string; args: Record<string, unknown>; result: ToolResult; elapsed: number }> = [];
  private startTime = 0;

  constructor(options: SmartSubAgentOptions) {
    this.parentAgent = options.parentAgent;

    // Prepend session context to instruction so sub-agents understand the bigger picture
    const parentCtx = (options.parentAgent as unknown as { buildAgenticContext?: () => string }).buildAgenticContext?.() || '';
    this.instruction = parentCtx
      ? `${parentCtx}\n\n[TASK]\n${options.instruction}`
      : options.instruction;

    this.allowedTools = options.tools ? this.deriveAllowedTools(options.tools) : [];

    const parentConfig = (options.parentAgent as unknown as { config: AgentXConfig }).config;
    this.config = options.config ? { ...parentConfig, ...options.config } : parentConfig;
    this.sessionId = options.sessionId ?? generateSubSessionId();
    this.systemPromptOverride = options.systemPromptOverride;
    this.crewPermissions = options.crewPermissions ?? [];
    this.missionContext = options.missionContext;
    this.displayName = options.displayName;
    this.childSessionKind = options.childSessionKind
      ?? (options.systemPromptOverride ? 'crew_worker' : 'sub_agent');
    this.inboundChannel = options.inboundChannel;
    this.inboundThreadId = options.inboundThreadId;
    this.inboundMessageId = options.inboundMessageId;
  }

  /**
   * Execute the sub-agent mission. Creates a full Agent instance and runs it.
   */
  async execute(): Promise<SmartSubAgentResult> {
    this.startTime = Date.now();
    const subEventBus = new AgentEventBus();
    let subAgent: Agent | null = null;

    try {
      let toolRegistry: ToolRegistry | undefined;
      let toolExecutor: ToolExecutor | undefined;

      const parentRegistry = (this.parentAgent as unknown as { toolRegistry?: ToolRegistry }).toolRegistry;
      const parentExecutor = (this.parentAgent as unknown as { toolExecutor?: EnhancedToolExecutor }).toolExecutor;

      const scopePath = this.resolveParentScopePath(parentExecutor);

      if (parentRegistry && parentExecutor) {
        if (this.allowedTools.length > 0) {
          const { ToolRegistry } = await import('../tools/ToolRegistry.js');
          toolRegistry = new ToolRegistry();
          for (const toolId of this.allowedTools) {
            const def = parentRegistry.get(toolId);
            if (def) toolRegistry.register(def);
          }
          const childExecutor = new EnhancedToolExecutor(toolRegistry, scopePath);
          childExecutor.copyExecutionPolicyFrom(parentExecutor);
          // Override inbound channel context with values captured at spawn time.
          // For background sub-agents the parent executor's inbound source may have
          // been reset by the time the background task actually runs.
          if (this.inboundChannel !== undefined) childExecutor.setInboundSourceChannel(this.inboundChannel ?? null);
          if (this.inboundThreadId !== undefined) childExecutor.setInboundSourceThreadId(this.inboundThreadId ?? null);
          if (this.inboundMessageId !== undefined) childExecutor.setInboundSourceMessageId(this.inboundMessageId ?? null);
          if (this.crewPermissions.length > 0) {
            const baseRules = (childExecutor as unknown as { sessionRules: PermissionRule[] }).sessionRules ?? [];
            childExecutor.setSessionRules([...baseRules, ...this.crewPermissions]);
          }
          toolExecutor = childExecutor;
        } else {
          toolRegistry = parentRegistry;
          toolExecutor = parentExecutor;
        }
      }

      this.parentAgent.createChildSession(this.sessionId, {
        kind: this.childSessionKind,
        label: this.displayName ?? (this.childSessionKind === 'crew_worker' ? 'Crew worker' : 'Sub-Agent'),
      });

      const parentSessionManager = (this.parentAgent as unknown as {
        sessionManager?: SessionManager;
      }).sessionManager;

      const onPart: PartPersistFn = (sessionId, part) => {
        try {
          const store = parentSessionManager?.getStorageAdapter?.();
          if (store && typeof store.insertPart === 'function') {
            // PartPersistFn and StorageAdapter.insertPart share the same shape at runtime.
            (store.insertPart as (sid: string, p: typeof part) => void)(sessionId, part);
          }
        } catch { /* best-effort */ }
      };

      subAgent = new Agent({
        config: this.config,
        sessionId: this.sessionId,
        scopePath,
        systemPrompt: this.buildSubAgentPrompt(),
        promptProfile: this.systemPromptOverride ? 'crew_worker' : 'default',
        delegatedWorker: true,
        parentSessionId: this.parentAgent.currentSessionId,
        toolRegistry,
        toolExecutor,
        eventBus: subEventBus,
        onPart,
        missionContextProvider: this.missionContext
          ? () => ({
            revision: this.missionContext!.contextRevision,
            block: this.missionContext!.getSharedContextBlock(),
          })
          : undefined,
      });

      // Critical: without SessionManager the child never persists user/assistant messages,
      // so the dedicated sub-agent panel stays empty.
      if (parentSessionManager) {
        subAgent.setSessionManager(parentSessionManager);
      }

      const childStore = parentSessionManager?.getStorageAdapter?.() as
        | { insertPart?: (sid: string, part: Record<string, unknown>) => void }
        | undefined;

      // Persist tool parts in real-time as the child agent runs, and forward to parent UI
      subEventBus.on((event) => {
        const evType = (event as { type?: string }).type ?? '';

        if (childStore?.insertPart) {
          if (evType === 'tool_executing') {
            const toolName = ((event as { tool?: string }).tool) ?? '';
            const toolCallId = (event as { callId?: string; toolCallId?: string }).callId
              || (event as { toolCallId?: string }).toolCallId
              || randomUUID();
            const toolArgs = (event as { args?: Record<string, unknown> }).args;
            childStore.insertPart(this.sessionId, { type: 'tool-call', toolName, toolCallId, toolArgs });
          }
          if (evType === 'tool_complete') {
            const toolName = ((event as { tool?: string }).tool) ?? '';
            const toolCallId = (event as { callId?: string; toolCallId?: string }).callId
              || (event as { toolCallId?: string }).toolCallId
              || '';
            const result = (event as { result?: { success?: boolean; output?: string } }).result ?? {};
            childStore.insertPart(this.sessionId, {
              type: 'tool-result',
              toolName,
              toolCallId,
              toolResult: result.output ?? '',
              toolSuccess: result.success ?? false,
            });
          }
        }

        // Forward to parent UI tagged with subagentId so the sub-agent drawer can stream live
        // (main chat only shows "waiting for sub-agent" — not these details).
        if (
          evType === 'message_received'
          || evType === 'tool_executing'
          || evType === 'tool_complete'
          || evType === 'tool_output'
          || evType === 'thinking_delta'
          || evType === 'reasoning_delta'
          || evType === 'stream_chunk'
        ) {
          (this.parentAgent as unknown as { emit?: (event: unknown) => void }).emit?.({
            type: 'subagent_event',
            subagentId: this.sessionId,
            parentEvent: event,
          });
        }

        // Capture tool calls for the result
        if (evType === 'tool_complete') {
          const toolName = ((event as { tool?: string }).tool) ?? '';
          const args = (event as { args?: Record<string, unknown> }).args ?? {};
          const result = (event as { result?: ToolResult }).result ?? { success: false, output: '' };
          const elapsed = (event as { elapsed?: number }).elapsed ?? 0;
          this.toolCallsLog.push({ name: toolName, args, result, elapsed });
        }
      });

      await subAgent.sendMessage(this.instruction);

      const lastMessage = subAgent.getMessageHistory().find((m) => m.role === 'assistant');
      const output = lastMessage?.content ?? '';

      return {
        success: true,
        output,
        toolCalls: this.toolCallsLog,
        elapsed: Date.now() - this.startTime,
        tokenUsage: {
          input: (subAgent as unknown as { tokenTracker?: { inputTokenCount: number } }).tokenTracker?.inputTokenCount ?? 0,
          output: (subAgent as unknown as { tokenTracker?: { outputTokenCount: number } }).tokenTracker?.outputTokenCount ?? 0,
        },
      };
    } catch (error) {
      logger.error('SmartSubAgent', `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        output: `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}`,
        toolCalls: this.toolCallsLog,
        elapsed: Date.now() - this.startTime,
        tokenUsage: { input: 0, output: 0 },
      };
    } finally {
      subAgent?.dispose();
      this.toolCallsLog = [];
    }
  }

  private resolveParentScopePath(parentExecutor?: ToolExecutor): string {
    if (parentExecutor && 'getScopePath' in parentExecutor) {
      const fromExecutor = (parentExecutor as { getScopePath(): string }).getScopePath();
      if (fromExecutor) return fromExecutor;
    }
    const fromAgent = this.parentAgent.getScopePath();
    if (fromAgent) return fromAgent;
    throw new Error('Parent agent has no scope path configured for sub-agent tools');
  }

  private deriveAllowedTools(requestedTools: string[]): string[] {
    const deniedTools = new Set(['delegate_to_subagent', 'sub_agent_spawn', 'spawn_crew_workers', 'todo_write', 'todo_delete']);
    return requestedTools.filter(t => !deniedTools.has(t));
  }

  private buildSubAgentPrompt(): string {
    if (this.systemPromptOverride) {
      return `${this.systemPromptOverride}\n\n[MISSION RULES]\nExecute the assigned task. Use available tools. Return a concise markdown summary of results.\n[/MISSION RULES]`;
    }
    const restrictedNote = `\nIMPORTANT: You cannot delegate to sub-agents or manage tasks.`;
    return `[MISSION]
Focus ONLY on completing the assigned task.

Rules:
1. Do NOT greet the user or ask unnecessary questions.
2. Use tools aggressively to complete the task.
3. If you encounter errors, try alternative approaches.
4. Return a CONCISE markdown summary of what you did and the final result.
${restrictedNote}

${this.allowedTools.length > 0 ? `Available tools: ${this.allowedTools.join(', ')}` : 'All tools available.'}
[/MISSION]`;
  }
}
