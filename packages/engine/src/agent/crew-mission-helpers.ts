/**
 * Crew mission helpers extracted from Agent.ts (REFACTOR-2, Group 3).
 *
 * These standalone functions accept a `CrewMissionContext` (the slice of
 * AgentFacade they need) instead of `this`, preserving all original behavior.
 */
import { streamText } from 'ai';
import type { Message, EngineEvent, AgentXConfig, CompletionMessage } from '@agentx/shared';
import { generateMessageId, getLogger } from '@agentx/shared';
import { createAiSdkModel } from './AiSdkBridge.js';
import type { CrewMember } from './CrewOrchestrator.js';
import type { CrewMissionResult } from './CrewMissionOrchestrator.js';
import type { ContextTracker } from './ContextTracker.js';
import type { Scope } from '../concurrency/Scope.js';
import type { AgentLifecycle } from './AgentLifecycle.js';
import type { RunStateManager } from './RunStateManager.js';
import type { CommandQueue } from '../communication/CommandQueue.js';
import type { TodoManager } from './TodoManager.js';
import type { TurnInjectionResult } from '../context/SessionContextHandler.js';

/** Slice of AgentFacade required by the crew mission helpers. */
export interface CrewMissionContext {
  sessionId: string;
  config: AgentXConfig;
  messages: CompletionMessage[];
  scope: Scope | null;
  contextTracker: ContextTracker;
  todoManager: TodoManager;
  lifecycle: AgentLifecycle;
  runStateMgr: RunStateManager;
  commandQueue: CommandQueue;
  getApiKey(): string | undefined;
  emit(event: EngineEvent, isUpdateFlag?: boolean): void;
  prepareTurnContext(currentUserMessage: string): TurnInjectionResult;
  getCrewMembers(): Array<{ crew: import('@agentx/shared').Crew; expertise: string[]; active: boolean }>;
  runCrewMissionAndPublish(
    members: CrewMember[],
    task: string,
    options?: { extraContext?: string; startTime?: number; emitLoading?: boolean },
  ): Promise<CrewMissionResult>;
  persistAssistantMessage(msg: Message): void;
  superviseCrewMission(mission: CrewMissionResult, cleanContent: string, startTime: number): Promise<string>;
}

export async function superviseCrewMission(
  ctx: CrewMissionContext,
  mission: CrewMissionResult,
  cleanContent: string,
  startTime: number,
): Promise<string> {
  const systemMsg = ctx.messages.find((m) => m.role === 'system');
  const systemContent = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
  const workerSummary = mission.workers.map((w) =>
    `@${w.callsign} (${w.crewName}) [${w.success ? 'ok' : 'failed'}]:\n${w.output.slice(0, 2000)}`,
  ).join('\n\n---\n\n');

  const turnCtx = ctx.prepareTurnContext(cleanContent);
  const reviewPrompt = `${systemContent}\n\n[CREW SUPERVISOR]\nYou are Agent-X, the project manager supervising a crew mission. Review worker outputs, resolve conflicts, and deliver the final cohesive answer to the user. If the mission failed or needs user input, say so clearly and concisely.\n[/CREW SUPERVISOR]`;

  try {
    const model = createAiSdkModel(ctx.config, ctx.getApiKey());
    const r = await streamText({
      model,
      messages: [
        { role: 'system', content: reviewPrompt },
        {
          role: 'user',
          content: `${turnCtx.block}\n\nUser request: ${turnCtx.mergedTask}\n\nMission success: ${mission.success}\n\nCrew outputs:\n${workerSummary}\n\nProvide your final supervised response:`,
        },
      ],
      maxOutputTokens: 4096,
    });
    let text = '';
    for await (const chunk of r.textStream) { text += chunk; }
    if (text.trim()) {
      const msg: Message = {
        id: generateMessageId(),
        sessionId: ctx.sessionId,
        role: 'assistant',
        content: text,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: Math.ceil(text.length / 4),
      };
      ctx.messages.push({ role: 'assistant', content: text });
      ctx.emit({ type: 'message_received', message: msg, elapsed: Date.now() - startTime });
    }
    return text.trim() || mission.synthesized;
  } catch {
    return mission.synthesized;
  }
}

export function publishCrewMissionResponses(
  ctx: CrewMissionContext,
  mission: CrewMissionResult,
  members: CrewMember[],
  startTime: number,
): void {
  for (const r of mission.responses) {
    const crewMember = members.find((m) => m.crew.id === r.crewId);
    if (!crewMember) {
      getLogger().warn('CREW_MISSION', `Response crewId ${r.crewId} not in mission members — skipping misattributed publish`);
      continue;
    }
    const msg: Message = {
      id: generateMessageId(),
      sessionId: ctx.sessionId,
      role: 'assistant',
      content: r.content,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
      crew: {
        crewId: crewMember.crew.id,
        name: r.member,
        callsign: r.callsign,
        color: crewMember.crew.color,
        icon: crewMember.crew.icon,
        confidence: mission.success ? 'high' : 'medium',
        reasons: [`Crew worker @${r.callsign}`],
      },
    };
    ctx.messages.push({ role: 'assistant', content: `[${r.member} (@${r.callsign})]:\n${r.content}` });
    ctx.contextTracker.record('crew', r.content, r.member);
    ctx.persistAssistantMessage(msg);
    ctx.emit({ type: 'message_received', message: msg, elapsed: Date.now() - startTime });
  }
}

/**
 * Orchestrate parallel crew workers under Agent-X supervision.
 * Replaces the old routeToCrews bypass — workers run full agentic loops with crew personas.
 */
export async function executeCrewMission(
  ctx: CrewMissionContext,
  members: CrewMember[],
  cleanContent: string,
  startTime: number,
  _classificationContext?: string,
): Promise<Message> {
  const mission = await ctx.runCrewMissionAndPublish(members, cleanContent, {
    extraContext: _classificationContext,
    startTime,
    emitLoading: true,
  });

  let lastMessage: Message | null = mission.responses.length > 0
    ? {
        id: generateMessageId(),
        sessionId: ctx.sessionId,
        role: 'assistant',
        content: mission.responses[mission.responses.length - 1]!.content,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: 0,
      }
    : null;

  const needsSupervision = mission.responses.length > 1 || !mission.success;
  if (needsSupervision) {
    const supervisorReview = await ctx.superviseCrewMission(mission, cleanContent, startTime);
    mission.supervisorReview = supervisorReview;
    if (supervisorReview && supervisorReview !== mission.synthesized) {
      const synthMsg: Message = {
        id: generateMessageId(),
        sessionId: ctx.sessionId,
        role: 'assistant',
        content: supervisorReview,
        toolCalls: null,
        createdAt: new Date().toISOString(),
        tokenCount: Math.ceil(supervisorReview.length / 4),
      };
      ctx.messages.push({ role: 'assistant', content: supervisorReview });
      ctx.emit({ type: 'message_received', message: synthMsg, elapsed: Date.now() - startTime });
      lastMessage = synthMsg;
    }
  } else if (mission.responses.length === 1) {
    lastMessage = lastMessage ?? {
      id: generateMessageId(), sessionId: ctx.sessionId, role: 'assistant',
      content: mission.synthesized || '', toolCalls: null, createdAt: new Date().toISOString(), tokenCount: 0,
    };
  } else if (mission.synthesized) {
    const synthMsg: Message = {
      id: generateMessageId(),
      sessionId: ctx.sessionId,
      role: 'assistant',
      content: mission.synthesized,
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 0,
    };
    ctx.messages.push({ role: 'assistant', content: mission.synthesized });
    ctx.emit({ type: 'message_received', message: synthMsg, elapsed: Date.now() - startTime });
    lastMessage = synthMsg;
  }

  ctx.emit({ type: 'loading_end' });
  ctx.lifecycle.forceTransition('idle');
  ctx.scope = null;
  ctx.runStateMgr.release(ctx.sessionId);
  ctx.commandQueue.release(ctx.sessionId);
  return lastMessage ?? {
    id: generateMessageId(), sessionId: ctx.sessionId, role: 'assistant',
    content: mission.synthesized || '', toolCalls: null, createdAt: new Date().toISOString(), tokenCount: 0,
  };
}

/**
 * Auto-delegation: before Agent-X responds, check if any enabled crew
 * member's expertise matches the user message.
 * Uses LLM-powered semantic matching (scalable to any domain).
 */
export function extractTasksFromResponse(ctx: CrewMissionContext, content: string): void {
  const conversational = /\b(game|option|choice|suggestion|recommendation|example|sample|or you could|why not try|how about|feel free|pick one|choose from)\b/i;
  if (conversational.test(content)) return;

  const lines = content.split('\n');
  const taskLines: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    if (/^\s*[-*•]\s+/.test(stripped) || /^\s*\d+[.)]\s+/.test(stripped)) {
      taskLines.push(stripped);
    }
  }

  if (taskLines.length < 2) return;

  const tasks = taskLines
    .map((l) => l.replace(/^[\s]*[-*•]\s+/, '').replace(/^[\s]*\d+[.)]\s+/, '').trim())
    .map((t) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`(.+?)`/g, '$1'))
    .filter((t) => t.length > 5 && t.length < 200);

  if (tasks.length >= 2) {
    // Never clobber an agent-managed checklist — only seed when empty.
    if (ctx.todoManager.getItems().length > 0) return;
    ctx.todoManager.addItems(tasks);
    getLogger().info('TODO_EXTRACT', `Extracted ${tasks.length} tasks from response`);
  }
}

/** Composer `@crew[callsign:…]` / `@crew:callsign` tokens (callsign or id keys). */
export function parseCrewMentionKeys(content: string): string[] {
  const normalized = content.replace(/\u200b/g, '');
  const keys: string[] = [];
  const push = (raw: string) => {
    const key = raw.trim();
    if (!key) return;
    const lower = key.toLowerCase();
    if (lower === 'file' || lower === 'crew') return;
    if (!keys.some((k) => k.toLowerCase() === lower)) keys.push(key);
  };

  for (const match of normalized.matchAll(/@crew\[([^:\]]+)/g)) {
    push(match[1]!);
  }
  for (const match of normalized.matchAll(/@crew:([^:\s\[\]]+)(?::[^\s\[\]?!,;:)'"]+)?/g)) {
    push(match[1]!);
  }
  return keys;
}

export function detectAtMentions(ctx: CrewMissionContext, content: string): string[] {
  const normalized = content.replace(/\u200b/g, '');
  const mentioned: string[] = [];
  const members = ctx.getCrewMembers();

  const pushIfFound = (name: string) => {
    const key = name.toLowerCase();
    if (key === 'file' || key === 'crew') return;
    const found = members.find(
      (m) => m.crew.callsign.toLowerCase() === key
        || m.crew.name.toLowerCase() === key
        || m.crew.name.toLowerCase().replace(/\s+/g, '_') === key
        || m.crew.id.toLowerCase() === key,
    );
    if (found && !mentioned.includes(found.crew.id)) {
      mentioned.push(found.crew.id);
    }
  };

  for (const key of parseCrewMentionKeys(normalized)) {
    pushIfFound(key);
  }

  // Legacy bare @callsign (and still useful when models emit @callsign)
  for (const match of normalized.matchAll(/(?<!\w)@([\w][\w.-]*)/g)) {
    pushIfFound(match[1]!);
  }

  return mentioned;
}
