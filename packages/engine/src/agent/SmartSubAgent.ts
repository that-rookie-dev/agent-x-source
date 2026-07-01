import type { AgentXConfig, PermissionRule, ToolResult } from '@agentx/shared';
import { generateSubSessionId, getLogger } from '@agentx/shared';
import { Agent } from './Agent.js';
import { AgentEventBus } from '../EventBus.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { EnhancedToolExecutor } from '../tools/EnhancedToolExecutor.js';
import type { CrewMissionContext } from './CrewMissionContext.js';
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
  planMode?: boolean;
  crewPermissions?: PermissionRule[];
  missionContext?: CrewMissionContext;
  childSessionKind?: 'sub_agent' | 'crew_worker';
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
  private systemPromptOverride?: string;
  private planMode: boolean;
  private crewPermissions: PermissionRule[];
  private missionContext?: CrewMissionContext;
  private displayName?: string;
  private childSessionKind: 'sub_agent' | 'crew_worker';
  private abortController = new AbortController();
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
    this.timeout = options.timeout ?? 120_000;

    const parentConfig = (options.parentAgent as unknown as { config: AgentXConfig }).config;
    this.config = options.config ? { ...parentConfig, ...options.config } : parentConfig;
    this.sessionId = options.sessionId ?? generateSubSessionId();
    this.systemPromptOverride = options.systemPromptOverride;
    this.planMode = options.planMode ?? false;
    this.crewPermissions = options.crewPermissions ?? [];
    this.missionContext = options.missionContext;
    this.displayName = options.displayName;
    this.childSessionKind = options.childSessionKind
      ?? (options.systemPromptOverride ? 'crew_worker' : 'sub_agent');
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
          if (this.crewPermissions.length > 0) {
            const baseRules = (childExecutor as unknown as { sessionRules: PermissionRule[] }).sessionRules ?? [];
            childExecutor.setSessionRules([...baseRules, ...this.crewPermissions]);
          }
          if (this.planMode) childExecutor.setMode('plan');
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
        missionContextProvider: this.missionContext
          ? () => ({
            revision: this.missionContext!.contextRevision,
            block: this.missionContext!.getSharedContextBlock(),
          })
          : undefined,
      });

      subAgent.autoApproveTools = this.parentAgent.autoApproveTools;
      if (this.planMode) subAgent.setPlanMode(true);

      // Wire up session-based persistence so the child session is replayable
      const sessionManager = (this.parentAgent as unknown as { sessionManager?: { store?: { insertMessage?: (msg: Record<string, unknown>) => void; insertPart?: (sid: string, part: Record<string, unknown>) => void } } }).sessionManager;
      const childStore = sessionManager?.store;

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
            const result = (event as { result?: unknown; output?: string }).result
              ?? (event as { output?: string }).output
              ?? '';
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result ?? '');
            childStore.insertPart(this.sessionId, { type: 'tool-result', toolName, toolCallId, toolResult: resultStr, toolSuccess: true });
          }
        }

        this.parentAgent.events.emit({
          type: 'subagent_event',
          subagentId: this.sessionId,
          parentEvent: event,
        });
      });

      const timeoutId = setTimeout(() => {
        this.abortController.abort();
        subAgent?.cancel();
      }, this.timeout);

      const result = await subAgent.sendMessage(this.instruction);

      clearTimeout(timeoutId);

      if (childStore?.insertMessage) {
        const messages = subAgent.getMessageHistory();
        for (const msg of messages) {
          if (msg.role === 'system') continue;
          childStore.insertMessage({
            sessionId: this.sessionId,
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            toolCalls: (msg as { toolCalls?: unknown }).toolCalls,
            tokenCount: (msg as { tokenCount?: number }).tokenCount,
          });
        }
      }

      const subTracker = (subAgent as unknown as { tokenTracker?: { inputTokenCount: number; outputTokenCount: number } }).tokenTracker;
      const tokenUsage = {
        input: subTracker?.inputTokenCount ?? 0,
        output: subTracker?.outputTokenCount ?? 0,
      };

      const output = result.content ?? '';
      const aborted = this.abortController.signal.aborted;
      const logicalFailure = !output.trim()
        || /\[Error:|failed to|could not complete|no scope path/i.test(output);

      return {
        success: !aborted && !logicalFailure,
        output: aborted ? `Sub-agent timed out after ${this.timeout}ms` : output,
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

  private resolveParentScopePath(parentExecutor?: ToolExecutor): string {
    if (parentExecutor instanceof EnhancedToolExecutor) {
      return parentExecutor.getScopePath();
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
    const planModeNote = this.planMode
      ? `\nPLAN MODE (read-only): Use read/search/research tools freely. Do NOT write files or run mutating shell commands.
If a write would help, include the plan, analysis, or draft content in your markdown response instead.
Always finish with a complete markdown answer — never wait for user approval.`
      : '';

    if (this.systemPromptOverride) {
      return `${this.systemPromptOverride}\n\n[MISSION RULES]\nExecute the assigned task. Use available tools. Return a concise markdown summary of results.${planModeNote}\n[/MISSION RULES]`;
    }
    const restrictedNote = `\nIMPORTANT: You cannot delegate to sub-agents or manage tasks.`;
    return `[MISSION]
Focus ONLY on completing the assigned task.

Rules:
1. Do NOT greet the user or ask unnecessary questions.
2. Use tools aggressively to complete the task (read-only tools when in plan mode).
3. If you encounter errors, try alternative approaches.
4. Return a CONCISE markdown summary of what you did and the final result.
${restrictedNote}${planModeNote}

${this.allowedTools.length > 0 ? `Available tools: ${this.allowedTools.join(', ')}` : 'All tools available.'}
[/MISSION]`;
  }
}
