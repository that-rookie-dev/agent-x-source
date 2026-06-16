import type { Crew, EngineEvent, CollaborationProtocol, AgentXConfig } from '@agentx/shared';
import { generateMessageId, CREW_DOMAIN_KEYWORDS } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import type { AgentEventBus } from '../EventBus.js';
import { countInputTokens, estimateOutputTokens } from '../session/tokenCount.js';
import type { TokenTracker } from '../session/TokenTracker.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import { streamText, stepCountIs } from 'ai';
import { createAiSdkModel, createAiSdkTools } from './AiSdkBridge.js';

const STOP_WORDS = new Set(['and', 'the', 'of', 'in', 'for', 'to', 'a', 'an', 'is', 'on', 'at', 'by', 'with', 'or', 'as', 'be', 'it', 'no', 'not', 'but', 'from', 'has', 'had', 'was', 'are', 'were', 'been', 'can', 'will', 'may', 'shall', 'should', 'would', 'could']);

export interface CrewMember {
  crew: Crew;
  expertise: string[];
  active: boolean;
  tokensUsedThisSession: number;
  cpuTimeMs: number;
}

export interface CrewMessage {
  id: string;
  from: string;
  content: string;
  timestamp: string;
  replyTo?: string;
}

export interface OrchestratorEvent {
  type: 'crew_speaking' | 'crew_delegating' | 'crew_synthesizing' | 'crew_complete';
  crewMember?: string;
  content?: string;
  delegateTo?: string;
}

export class CrewOrchestrator {
  private members: CrewMember[] = [];
  private conversation: CrewMessage[] = [];
  private provider: ProviderInterface;
  private eventBus: AgentEventBus;
  private primaryMember: CrewMember | null = null;
  private activeModel: string = '';
  private toolRegistry?: ToolRegistry;
  private toolExecutor?: ToolExecutor;
  private config?: AgentXConfig;
  private sessionId: string = 'crew';

  constructor(provider: ProviderInterface, eventBus: AgentEventBus, tokenTracker?: TokenTracker) {
    this.provider = provider;
    this.eventBus = eventBus;
    this.tokenTracker = tokenTracker ?? null;
  }

  private tokenTracker: TokenTracker | null = null;

  setActiveModel(model: string): void {
    this.activeModel = model;
  }

  setTools(registry: ToolRegistry, executor: ToolExecutor): void {
    this.toolRegistry = registry;
    this.toolExecutor = executor;
  }

  setConfig(config: AgentXConfig): void {
    this.config = config;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  addMember(crew: Crew): void {
    if (this.members.some(m => m.crew.id === crew.id)) return;
    const expertise = crew.expertise && crew.expertise.length > 0
      ? crew.expertise
      : this.extractExpertise(crew.systemPrompt);
    this.members.push({
      crew,
      expertise,
      active: false,
      tokensUsedThisSession: 0,
      cpuTimeMs: 0,
    });
    if (!this.primaryMember) {
      this.primaryMember = this.members[0]!;
      this.primaryMember.active = true;
    }
  }

  removeMember(crewId: string): void {
    this.members = this.members.filter(m => m.crew.id !== crewId);
    if (this.primaryMember?.crew.id === crewId) {
      this.primaryMember = this.members[0] ?? null;
    }
  }

  getMembers(): CrewMember[] {
    return [...this.members];
  }

  getConversation(): CrewMessage[] {
    return [...this.conversation];
  }

  routeMessage(userMessage: string): CrewMember[] {
    if (this.members.length <= 1) {
      return this.members.slice(0, 1);
    }

    const lower = userMessage.toLowerCase();
    const scored = this.members.map(member => {
      let score = 0;
      for (const keyword of member.expertise) {
        if (lower.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }
      if (member === this.primaryMember) score += 1;
      if (member.active) score += 1;
      return { member, score };
    });

    scored.sort((a, b) => b.score - a.score);

    if (scored.length >= 2 && scored[0]!.score > scored[1]!.score + 2) {
      return [scored[0]!.member];
    }

    const wordCount = userMessage.split(/\s+/).length;
    if (wordCount > 30 && scored.filter(s => s.score > 0).length > 1) {
      return scored.filter(s => s.score > 0).slice(0, 3).map(s => s.member);
    }

    return [scored[0]!.member];
  }

  private checkQuota(member: CrewMember): string | null {
    const q = member.crew.quotas;
    if (!q) return null;
    if (q.maxTokensPerSession && member.tokensUsedThisSession >= q.maxTokensPerSession) {
      return `${member.crew.name} has exceeded its session token quota (${member.tokensUsedThisSession}/${q.maxTokensPerSession})`;
    }
    if (q.maxCpuTimeMs && member.cpuTimeMs >= q.maxCpuTimeMs) {
      return `${member.crew.name} has exceeded its CPU time quota`;
    }
    return null;
  }

  private async callCrew(
    member: CrewMember,
    userMessage: string,
    _mainSystemPrompt: string,
    contextText?: string
  ): Promise<{ content: string; elapsed: number }> {
    const sections: string[] = [
      `You are ${member.crew.name}. ${member.crew.systemPrompt}

Use file_read, folder_list, code_search, code_grep, file_find, and code_references tools to explore the workspace and gather information before answering. Be thorough — use glob patterns to find relevant files, read them, and base your analysis on real code.`,
    ];

    const crewHistory = this.buildCrewContext(member, userMessage);
    if (contextText) sections.push(`[SESSION CONTEXT]\n${contextText}`);
    if (crewHistory) sections.push(`[CREW HISTORY]\n${crewHistory}`);

    const systemPrompt = sections.join('\n\n');
    const startTime = Date.now();
    const emit = (e: EngineEvent) => this.eventBus.emit(e);

    // ── AI SDK path: tools available ──────────────────────────────────────────
    if (this.toolRegistry && this.toolExecutor && this.config) {
      try {
        return await this.callCrewWithAiSdk(member, userMessage, systemPrompt, startTime, emit);
      } catch (err) {
        // Fall through to legacy path on error
      }
    }

    // ── Legacy path: plain provider.complete() fallback ───────────────────────
    const completion = this.provider.complete({
      model: this.activeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      maxTokens: member.crew.quotas?.maxTokensPerTurn ?? 4096,
    });

    let content = '';
    for await (const chunk of completion) {
      if (chunk.content) content += chunk.content;
    }

    const parsed = this.parseJsonAnswer(content);
    content = parsed || this.stripPlanningPrefix(content);

    if (/^(Your direct response|Output ONLY|Respond in JSON)/i.test(content.trim())) {
      content = content.trim().split('\n')[0]!;
    }

    const elapsed = Date.now() - startTime;
    member.cpuTimeMs += elapsed;
    const outputTokens = estimateOutputTokens(content);
    const inputTokens = countInputTokens(systemPrompt + userMessage);
    member.tokensUsedThisSession += outputTokens;
    if (this.tokenTracker) {
      this.tokenTracker.addTokenUsage(inputTokens, outputTokens);
      const costUsd = (inputTokens * this.tokenTracker.inputPrice + outputTokens * this.tokenTracker.outputPrice) / 1_000_000;
      this.eventBus.emit({ type: 'token_usage', totalTokens: this.tokenTracker.tokensUsed, contextWindow: this.tokenTracker.tokensTotal, turnTokens: inputTokens + outputTokens, costUsd, inputTokens: this.tokenTracker.inputTokenCount, outputTokens: this.tokenTracker.outputTokenCount, inputPrice: this.tokenTracker.inputPrice, outputPrice: this.tokenTracker.outputPrice } as unknown as EngineEvent);
    }

    return { content, elapsed };
  }

  private async callCrewWithAiSdk(
    member: CrewMember,
    userMessage: string,
    systemPrompt: string,
    startTime: number,
    emit: (e: EngineEvent) => void,
  ): Promise<{ content: string; elapsed: number }> {
    // Filter tools to read-only exploration set
    const CREW_READ_TOOLS = new Set(['file_read', 'folder_list', 'file_find', 'code_search', 'code_grep', 'code_references']);
    const { ToolRegistry: TR } = await import('../tools/ToolRegistry.js');
    const filteredRegistry = new TR();
    for (const toolId of CREW_READ_TOOLS) {
      const def = this.toolRegistry!.get(toolId);
      if (def) filteredRegistry.register(def);
    }

    const tools = createAiSdkTools(
      filteredRegistry,
      this.toolExecutor!,
      this.sessionId,
      emit,
      () => Promise.resolve('Clarification not available in crew mode.'),
      () => Promise.resolve({ success: false as const, output: 'Sub-agents not supported in crew mode.', elapsed: 0 }),
    );

    const model = createAiSdkModel(this.config!);

    const result = streamText({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      tools,
      temperature: 0,
      stopWhen: stepCountIs(5),
    });

    let content = '';
    for await (const chunk of result.fullStream) {
      switch (chunk.type) {
        case 'text-delta': {
          const delta = (chunk as any).textDelta || (chunk as any).text || '';
          content += delta;
          emit({ type: 'stream_chunk', content: delta, fullContent: content });
          break;
        }
        case 'error': {
          const errMsg = String((chunk as any).error || 'AI SDK error');
          emit({ type: 'error', code: 'CREW_AI_SDK_ERROR', message: errMsg, recoverable: false } as unknown as EngineEvent);
          break;
        }
      }
    }

    if (!content) content = `${member.crew.name} was unable to generate a response.`;

    const elapsed = Date.now() - startTime;
    member.cpuTimeMs += elapsed;
    const outputTokens = estimateOutputTokens(content);
    const inputTokens = countInputTokens(systemPrompt + userMessage);
    member.tokensUsedThisSession += outputTokens;
    if (this.tokenTracker) {
      this.tokenTracker.addTokenUsage(inputTokens, outputTokens);
      const costUsd = (inputTokens * this.tokenTracker.inputPrice + outputTokens * this.tokenTracker.outputPrice) / 1_000_000;
      emit({ type: 'token_usage', totalTokens: this.tokenTracker.tokensUsed, contextWindow: this.tokenTracker.tokensTotal, turnTokens: inputTokens + outputTokens, costUsd, inputTokens: this.tokenTracker.inputTokenCount, outputTokens: this.tokenTracker.outputTokenCount, inputPrice: this.tokenTracker.inputPrice, outputPrice: this.tokenTracker.outputPrice } as unknown as EngineEvent);
    }

    return { content, elapsed };
  }

  /**
   * Try to parse a JSON response from the LLM. Handles:
   * - Raw JSON: {"answer":"...","reasoning":"..."}
   * - JSON wrapped in markdown code fences: ```json\n...\n```
   * - JSON with surrounding text (extracts first JSON object found)
   *
   * Returns the "answer" field if found, or null to trigger fallback.
   */
  private parseJsonAnswer(raw: string): string | null {
    // Remove markdown code fences
    const text = raw.replace(/```(?:json)?\s*\n?/gi, '').replace(/\n?```/g, '');

    // Find the first '{' and extract the complete JSON object (handles nested braces)
    const start = text.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inString) {
        if (ch === '\\') { i++; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (depth === 0) { end = i; break; }
    }

    if (end < 0) return null;

    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      if (obj.answer && typeof obj.answer === 'string' && obj.answer.trim().length > 0) {
        return obj.answer.trim();
      }
    } catch {
      // Invalid JSON — fall through
    }

    return null;
  }

  private stripPlanningPrefix(content: string): string {
    const lines = content.split('\n');
    let startIdx = 0;
    const cotPattern = /^(Given that I|Thinking|Here(‘|')s (what|my)|Output only|Final:|Let me|I need to|We need to|I should|We should|First I'll|I will |I'll |We'll |We are |I am |As (an |)AI |The user |Sure, I'd|Sure! I'd|According to|But the instruction|The instruction says|The rules say|Based on the rules|Per the rules|But let's)/i;
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const trimmed = lines[i]!.trim();
      if (!trimmed) { startIdx = i + 1; continue; }
      if (cotPattern.test(trimmed)) { startIdx = i + 1; continue; }
      if (/^\[.*\]$/.test(trimmed) && trimmed.length < 60) { startIdx = i + 1; continue; }
      if (/^\d+\.\s+\*\*/i.test(trimmed) && /Analyze|Identify|Consider|Evaluate|Break.*down|Plan|Approach|Task|Step/i.test(trimmed)) {
        startIdx = i + 1;
        continue;
      }
      break;
    }
    if (startIdx > 0) {
      return lines.slice(startIdx).join('\n').trim();
    }
    return content;
  }

  hasExpertiseFor(member: CrewMember, userMessage: string, contextText?: string): boolean {
    const searchText = (userMessage + ' ' + (contextText ?? '')).toLowerCase();

    // Check expertise tags
    if (member.expertise && member.expertise.length > 0) {
      return member.expertise.some((kw) => this.keywordOverlap(kw.toLowerCase(), searchText));
    }

    // Fallback: check system prompt for keyword overlap with message
    const promptLower = member.crew.systemPrompt.toLowerCase();
    const msgWords = searchText.split(/[\s,;/]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    return msgWords.some((w) => promptLower.includes(w));
  }

  /**
   * Check if significant words from a multi-word expertise keyword
   * appear in the search text. Avoids requiring exact phrase matches.
   */
  private keywordOverlap(expertise: string, searchText: string): boolean {
    const words = expertise.split(/[\s,;/]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    if (words.length === 0) return searchText.includes(expertise);
    const matched = words.filter((w) => searchText.includes(w));
    // Require at least 1 match for short phrases, 2 for longer ones
    return words.length <= 2 ? matched.length >= 1 : matched.length >= 2;
  }

  async processMessage(userMessage: string, mainSystemPrompt: string, explicitResponders?: CrewMember[], contextText?: string): Promise<{ responses: Array<{ member: string; content: string }>; synthesized?: string }> {
    this.conversation.push({
      id: generateMessageId(),
      from: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    const responders = explicitResponders ?? this.routeMessage(userMessage);
    const responses: Array<{ member: string; content: string }> = [];

    this.emit({ type: 'loading_start', stage: 'crew_routing' });

    const protocol = this.resolveProtocol(responders);

    if (protocol === 'debate') {
      const debateResponses = await this.runDebate(responders, userMessage, mainSystemPrompt);
      responses.push(...debateResponses);
    } else if (protocol === 'sequential') {
      const seqResponses = await this.runSequential(responders, userMessage, mainSystemPrompt);
      responses.push(...seqResponses);
    } else if (protocol === 'handoff') {
      const handoffResponses = await this.runHandoff(responders, userMessage, mainSystemPrompt);
      responses.push(...handoffResponses);
    } else {
      // standard or parallel — run all responders concurrently
      const results = await Promise.allSettled(
        responders.map(async (responder) => {
          const quotaError = this.checkQuota(responder);
          if (quotaError) {
            this.emit({ type: 'tool_executing', tool: 'crew_member', description: `${responder.crew.name} is thinking...` });
            this.emit({ type: 'tool_complete', tool: 'crew_member', result: { success: false, output: quotaError }, elapsed: 0 });
            return { member: responder.crew.name, content: `[${quotaError}]` };
          }

          // AI SDK streaming emits its own tool_executing/stream_chunk events

          try {
            const { content } = await this.callCrew(responder, userMessage, mainSystemPrompt, contextText);

            this.conversation.push({
              id: generateMessageId(),
              from: responder.crew.name,
              content,
              timestamp: new Date().toISOString(),
            });

            return { member: responder.crew.name, content };
          } catch (err) {
            return { member: responder.crew.name, content: `[Error: ${err instanceof Error ? err.message : 'failed'}]` };
          }
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') responses.push(r.value);
      }
    }

    let synthesized: string | undefined;
    if (responses.length > 1) {
      synthesized = await this.synthesize(userMessage, responses, mainSystemPrompt);
    }

    return { responses, synthesized };
  }

  private resolveProtocol(responders: CrewMember[]): CollaborationProtocol {
    const uniqueProtocols = new Set(responders.map(r => r.crew.protocol ?? 'standard'));

    if (uniqueProtocols.size === 1) {
      const p = uniqueProtocols.values().next().value;
      if (p && p !== 'standard') return p;
    }

    // If primary has a specific protocol, use that
    if (this.primaryMember?.crew.protocol && this.primaryMember.crew.protocol !== 'standard') {
      return this.primaryMember.crew.protocol;
    }

    // Default to parallel for multi-crew, standard for single
    return responders.length > 1 ? 'parallel' : 'standard';
  }

  private async runDebate(
    participants: CrewMember[],
    userMessage: string,
    mainSystemPrompt: string
  ): Promise<Array<{ member: string; content: string }>> {
    const responses: Array<{ member: string; content: string }> = [];
    // Round 1: initial answers
    const initialResults = await Promise.allSettled(
      participants.map(async (p) => {
        const quotaError = this.checkQuota(p);
        if (quotaError) return { member: p.crew.name, content: `[${quotaError}]` };
        this.emit({ type: 'tool_executing', tool: 'crew_member', description: `${p.crew.name} is building initial argument...` });
        try {
          const { content } = await this.callCrew(p, userMessage, mainSystemPrompt);
          return { member: p.crew.name, content };
        } catch (err) {
          return { member: p.crew.name, content: `[Error: ${err instanceof Error ? err.message : 'failed'}]` };
        }
      })
    );

    const round1Results: Array<{ member: string; content: string }> = [];
    for (const r of initialResults) {
      if (r.status === 'fulfilled') round1Results.push(r.value);
    }

    for (const r of round1Results) {
      this.conversation.push({
        id: generateMessageId(),
        from: r.member,
        content: r.content,
        timestamp: new Date().toISOString(),
      });
    }

    // Round 2: critique and refine each other
    if (participants.length >= 2) {
      const critiqueResults = await Promise.allSettled(
        participants.map(async (p) => {
          const quotaError = this.checkQuota(p);
          if (quotaError) return { member: p.crew.name, content: `[${quotaError}]` };
          const others = round1Results.filter(r => r.member !== p.crew.name);
          if (others.length === 0) return { member: p.crew.name, content: round1Results.find(r => r.member === p.crew.name)?.content ?? '' };

          this.emit({ type: 'tool_executing', tool: 'crew_member', description: `${p.crew.name} is reviewing peers...` });

          const critiquePrompt = `Review the following responses from other team members. Provide your critique, identify any issues, and refine your own position:\n\n${others.map(r => `[${r.member}]:\n${r.content}`).join('\n\n---\n\n')}\n\nYour refined response:`;
          try {
            const { content } = await this.callCrew(p, critiquePrompt, mainSystemPrompt);
            return { member: p.crew.name, content };
          } catch (err) {
            return { member: p.crew.name, content: `[Error: ${err instanceof Error ? err.message : 'failed'}]` };
          }
        })
      );

      for (const r of critiqueResults) {
        if (r.status === 'fulfilled') responses.push(r.value);
      }
    } else {
      responses.push(...round1Results);
    }

    return responses;
  }

  private async runSequential(
    chain: CrewMember[],
    userMessage: string,
    mainSystemPrompt: string
  ): Promise<Array<{ member: string; content: string }>> {
    const responses: Array<{ member: string; content: string }> = [];
    let currentInput = userMessage;

    for (const member of chain) {
      const quotaError = this.checkQuota(member);
      if (quotaError) {
        responses.push({ member: member.crew.name, content: `[${quotaError}]` });
        continue;
      }

      this.emit({ type: 'tool_executing', tool: 'crew_member', description: `${member.crew.name} is processing...` });

      const contextNote = responses.length > 0
        ? `\n\nPrevious work by: ${responses.map(r => r.member).join(', ')}.\nBuild upon their results. Do not repeat what was already done.`
        : '';

      try {
        const { content } = await this.callCrew(member, currentInput + contextNote, mainSystemPrompt);

        this.conversation.push({
          id: generateMessageId(),
          from: member.crew.name,
          content,
          timestamp: new Date().toISOString(),
        });

        responses.push({ member: member.crew.name, content });
        currentInput = `Continue the work. Previous output from ${member.crew.name}:\n${content.slice(0, 1000)}`;
      } catch (err) {
        responses.push({ member: member.crew.name, content: `[Error: ${err instanceof Error ? err.message : 'failed'}]` });
      }
    }

    return responses;
  }

  private async runHandoff(
    handlers: CrewMember[],
    userMessage: string,
    mainSystemPrompt: string
  ): Promise<Array<{ member: string; content: string }>> {
    const responses: Array<{ member: string; content: string }> = [];

    if (handlers.length === 0) return responses;

    // First handler produces initial output
    const first = handlers[0]!;
    const quotaError = this.checkQuota(first);
    if (quotaError) {
      responses.push({ member: first.crew.name, content: `[${quotaError}]` });
      return responses;
    }

    this.emit({ type: 'tool_executing', tool: 'crew_member', description: `${first.crew.name} is producing initial work...` });

    try {
      const { content: firstOutput } = await this.callCrew(first, userMessage, mainSystemPrompt);
      this.conversation.push({
        id: generateMessageId(),
        from: first.crew.name,
        content: firstOutput,
        timestamp: new Date().toISOString(),
      });
      responses.push({ member: first.crew.name, content: firstOutput });

      // Remaining handlers refine in sequence
      for (let i = 1; i < handlers.length; i++) {
        const handler = handlers[i]!;
        const qErr = this.checkQuota(handler);
        if (qErr) {
          responses.push({ member: handler.crew.name, content: `[${qErr}]` });
          continue;
        }

        this.emit({ type: 'tool_executing', tool: 'crew_member', description: `${handler.crew.name} is refining...` });

        const handoffMessage = `Refine and improve the following work produced by ${responses[responses.length - 1]!.member}:\n\n${responses[responses.length - 1]!.content}\n\nYour improved version:`;

        try {
          const { content: refined } = await this.callCrew(handler, handoffMessage, mainSystemPrompt);
          this.conversation.push({
            id: generateMessageId(),
            from: handler.crew.name,
            content: refined,
            timestamp: new Date().toISOString(),
          });
          responses.push({ member: handler.crew.name, content: refined });
        } catch (err) {
          responses.push({ member: handler.crew.name, content: `[Error: ${err instanceof Error ? err.message : 'failed'}]` });
        }
      }
    } catch (err) {
      responses.push({ member: first.crew.name, content: `[Error: ${err instanceof Error ? err.message : 'failed'}]` });
    }

    return responses;
  }

  async interCrewMessage(fromId: string, toId: string, message: string, mainSystemPrompt: string): Promise<string> {
    const from = this.members.find(m => m.crew.id === fromId);
    const to = this.members.find(m => m.crew.id === toId);
    if (!from || !to) return '[Member not found]';

    const quotaError = this.checkQuota(to);
    if (quotaError) return `[${quotaError}]`;

    this.conversation.push({
      id: generateMessageId(),
      from: from.crew.name,
      content: `@${to.crew.name}: ${message}`,
      timestamp: new Date().toISOString(),
      replyTo: toId,
    });

    const context = this.buildCrewContext(to, message);
    const systemPrompt = `${mainSystemPrompt}\n\n[CREW MEMBER: ${to.crew.name}]\n${to.crew.systemPrompt}\n\n[CONVERSATION CONTEXT]\n${context}\n\n[NOTE: ${from.crew.name} is asking you a question. Respond directly.]`;

    try {
      const { content } = await this.callCrew(to, `[From ${from.crew.name}]: ${message}`, systemPrompt);

      this.conversation.push({
        id: generateMessageId(),
        from: to.crew.name,
        content,
        timestamp: new Date().toISOString(),
        replyTo: fromId,
      });

      return content;
    } catch (err) {
      return `[Error: ${err instanceof Error ? err.message : 'failed'}]`;
    }
  }

  private async synthesize(
    userMessage: string,
    responses: Array<{ member: string; content: string }>,
    mainSystemPrompt: string
  ): Promise<string> {
    const responseSummary = responses.map(r => `[${r.member}]:\n${r.content}`).join('\n\n---\n\n');

    const synthesisPrompt = `${mainSystemPrompt}\n\n[ORCHESTRATOR ROLE]\nYou are synthesizing responses from multiple crew members into a cohesive, unified answer.\nDo NOT repeat everything — extract the best insights from each, resolve any conflicts, and present a clear final answer.\nAttribute key insights to the crew member who provided them when relevant.`;

    try {
      const completion = this.provider.complete({
        model: this.activeModel,
        messages: [
          { role: 'system', content: synthesisPrompt },
          { role: 'user', content: `User asked: "${userMessage}"\n\nCrew responses:\n${responseSummary}\n\nSynthesize these into a single cohesive response:` },
        ],
        temperature: 0.5,
        maxTokens: 4096,
      });

      let content = '';
      for await (const chunk of completion) {
        if (chunk.content) content += chunk.content;
      }
      return content;
    } catch {
      return responses.map(r => `**${r.member}:**\n${r.content}`).join('\n\n');
    }
  }

  private buildCrewContext(_member: CrewMember, _currentMessage: string): string {
    const recent = this.conversation.slice(-10);
    if (recent.length === 0) return '';
    return recent.map(m => `[${m.from}]: ${m.content.slice(0, 200)}`).join('\n');
  }

  private extractExpertise(systemPrompt: string): string[] {
    const lower = systemPrompt.toLowerCase();
    return CREW_DOMAIN_KEYWORDS.filter((domain) => lower.includes(domain));
  }

  /**
   * LLM-powered crew matching: uses a minimal prompt to semantically match
   * the user's message to the best crew member. Infinitely scalable.
   * Falls back to keyword matching on error.
   */
  async matchCrew(userMessage: string, enabledMembers: CrewMember[]): Promise<CrewMember | null> {
    if (enabledMembers.length === 0) return null;
    if (enabledMembers.length === 1) return enabledMembers[0]!;

    const crewList = enabledMembers.map((m) => {
      const exp = (m.expertise && m.expertise.length > 0) ? m.expertise.join(', ') : 'general';
      const traits = (m.crew.traits && m.crew.traits.length > 0) ? m.crew.traits.join(', ') : '';
      return `- ${m.crew.name} (@${m.crew.callsign}): ${exp}${traits ? ` | traits: ${traits}` : ''}`;
    }).join('\n');

    const prompt = `Match this user request to the best crew member. Only match if the request CLEARLY fits their expertise.
If the match is weak or the query is vague (like "how can I..." or "what do you think about..."), respond with "none".
Respond with TWO lines: callsign (or "none"), then confidence (high/medium/low).

User: "${userMessage.slice(0, 300)}"

Crews:
${crewList}

Example output:
sam_wilson
high`;

    try {
      const completion = this.provider.complete({
        model: this.activeModel,
        messages: [
          { role: 'system', content: 'Routing classifier. Respond with callsign then confidence on separate lines.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        maxTokens: 30,
      });

      let content = '';
      for await (const chunk of completion) {
        if (chunk.content) content += chunk.content;
      }

      const lines = content.trim().split('\n').map((l) => l.trim().toLowerCase());
      const callsign = lines[0]?.replace(/[^a-z0-9_]/g, '') ?? '';
      const confidence = lines[1]?.replace(/[^a-z]/g, '') ?? '';

      if (!callsign || callsign === 'none' || confidence === 'low') return null;

      const matched = enabledMembers.find(
        (m) => m.crew.callsign.toLowerCase() === callsign || m.crew.name.toLowerCase() === callsign,
      );
      return matched ?? null;
    } catch {
      return null;
    }
  }

  private emit(event: Partial<EngineEvent> & { type: string }): void {
    this.eventBus.emit(event as EngineEvent);
  }
}