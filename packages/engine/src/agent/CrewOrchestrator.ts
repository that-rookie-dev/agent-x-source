import type { Crew, EngineEvent, CollaborationProtocol } from '@agentx/shared';
import { generateMessageId, CREW_DOMAIN_KEYWORDS } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import type { AgentEventBus } from '../EventBus.js';

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

  constructor(provider: ProviderInterface, eventBus: AgentEventBus) {
    this.provider = provider;
    this.eventBus = eventBus;
  }

  setActiveModel(model: string): void {
    this.activeModel = model;
  }

  addMember(crew: Crew): void {
    const expertise = this.extractExpertise(crew.systemPrompt);
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
    mainSystemPrompt: string
  ): Promise<{ content: string; elapsed: number }> {
    const crewContext = this.buildCrewContext(member, userMessage);
    const systemPrompt = `${mainSystemPrompt}\n\n[CREW MEMBER: ${member.crew.name}]\n${member.crew.systemPrompt}\n\n[CONVERSATION CONTEXT]\n${crewContext}`;

    const startTime = Date.now();
    const completion = this.provider.complete({
      model: this.activeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      maxTokens: member.crew.quotas?.maxTokensPerTurn ?? 4096,
    });

    let content = '';
    for await (const chunk of completion) {
      if (chunk.content) content += chunk.content;
    }

    const elapsed = Date.now() - startTime;
    member.cpuTimeMs += elapsed;
    member.tokensUsedThisSession += Math.ceil(content.length / 4);

    return { content, elapsed };
  }

  async processMessage(userMessage: string, mainSystemPrompt: string): Promise<{ responses: Array<{ member: string; content: string }>; synthesized?: string }> {
    this.conversation.push({
      id: generateMessageId(),
      from: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    const responders = this.routeMessage(userMessage);
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

          this.emit({ type: 'tool_executing', tool: 'crew_member', description: `${responder.crew.name} is thinking...` });

          try {
            const { content } = await this.callCrew(responder, userMessage, mainSystemPrompt);

            this.conversation.push({
              id: generateMessageId(),
              from: responder.crew.name,
              content,
              timestamp: new Date().toISOString(),
            });

            this.emit({ type: 'tool_complete', tool: 'crew_member', result: { success: true, output: `${responder.crew.name}: ${content.slice(0, 100)}` }, elapsed: 0 });
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

  private emit(event: Partial<EngineEvent> & { type: string }): void {
    this.eventBus.emit(event as EngineEvent);
  }
}