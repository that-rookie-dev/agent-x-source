/**
 * CrewOrchestrator — Multi-crew collaborative sessions.
 *
 * Manages sessions where multiple crew members collaborate:
 * - Routes user messages to the most relevant crew member(s)
 * - Allows crew members to communicate with each other
 * - Orchestrates turn-taking and parallel work
 * - Merges results into a cohesive session
 *
 * Each crew member is a "persona" with its own system prompt and expertise.
 * The orchestrator decides who speaks, when to delegate, and when to synthesize.
 */

import type { Crew, EngineEvent } from '@agentx/shared';
import { generateMessageId } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import type { AgentEventBus } from '../EventBus.js';

export interface CrewMember {
  crew: Crew;
  /** Expertise keywords for routing */
  expertise: string[];
  /** Whether this member is currently "speaking" */
  active: boolean;
}

export interface CrewMessage {
  id: string;
  from: string; // crew member name or 'user'
  content: string;
  timestamp: string;
  /** If this is a response to a specific message */
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

  constructor(provider: ProviderInterface, eventBus: AgentEventBus) {
    this.provider = provider;
    this.eventBus = eventBus;
  }

  /**
   * Add a crew member to this session.
   */
  addMember(crew: Crew): void {
    const expertise = this.extractExpertise(crew.systemPrompt);
    this.members.push({ crew, expertise, active: false });
    // First member added becomes primary
    if (!this.primaryMember) {
      this.primaryMember = this.members[0]!;
      this.primaryMember.active = true;
    }
  }

  /**
   * Remove a crew member.
   */
  removeMember(crewId: string): void {
    this.members = this.members.filter(m => m.crew.id !== crewId);
    if (this.primaryMember?.crew.id === crewId) {
      this.primaryMember = this.members[0] ?? null;
    }
  }

  /**
   * Get all members in this session.
   */
  getMembers(): CrewMember[] {
    return [...this.members];
  }

  /**
   * Get the full conversation history.
   */
  getConversation(): CrewMessage[] {
    return [...this.conversation];
  }

  /**
   * Route a user message to the appropriate crew member(s).
   * Returns the crew member(s) that should respond.
   */
  routeMessage(userMessage: string): CrewMember[] {
    if (this.members.length <= 1) {
      return this.members.slice(0, 1);
    }

    // Score each member by relevance to the message
    const lower = userMessage.toLowerCase();
    const scored = this.members.map(member => {
      let score = 0;
      for (const keyword of member.expertise) {
        if (lower.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }
      // Primary member gets a slight boost
      if (member === this.primaryMember) score += 1;
      // Active member gets a boost for continuity
      if (member.active) score += 1;
      return { member, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // If top score is clearly above others, single responder
    if (scored.length >= 2 && scored[0]!.score > scored[1]!.score + 2) {
      return [scored[0]!.member];
    }

    // If message is complex or mentions multiple domains, multi-respond
    const wordCount = userMessage.split(/\s+/).length;
    if (wordCount > 30 && scored.filter(s => s.score > 0).length > 1) {
      return scored.filter(s => s.score > 0).slice(0, 3).map(s => s.member);
    }

    // Default: primary member responds
    return [scored[0]!.member];
  }

  /**
   * Process a user message through the crew.
   * Handles routing, crew member responses, and inter-crew communication.
   */
  async processMessage(userMessage: string, mainSystemPrompt: string): Promise<{ responses: Array<{ member: string; content: string }>; synthesized?: string }> {
    // Add user message to conversation
    this.conversation.push({
      id: generateMessageId(),
      from: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    const responders = this.routeMessage(userMessage);
    const responses: Array<{ member: string; content: string }> = [];

    this.emit({ type: 'loading_start', stage: 'crew_routing' });

    for (const responder of responders) {
      this.emit({ type: 'tool_executing', tool: 'crew_member', description: `${responder.crew.name} is thinking...` });

      // Build context for this crew member
      const crewContext = this.buildCrewContext(responder, userMessage);
      const systemPrompt = `${mainSystemPrompt}\n\n[CREW MEMBER: ${responder.crew.name}]\n${responder.crew.systemPrompt}\n\n[CONVERSATION CONTEXT]\n${crewContext}`;

      try {
        const completion = this.provider.complete({
          model: '', // Uses active model
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.7,
          maxTokens: 4096,
        });

        let content = '';
        for await (const chunk of completion) {
          if (chunk.content) content += chunk.content;
        }

        responses.push({ member: responder.crew.name, content });

        // Add to conversation
        this.conversation.push({
          id: generateMessageId(),
          from: responder.crew.name,
          content,
          timestamp: new Date().toISOString(),
        });

        this.emit({ type: 'tool_complete', tool: 'crew_member', result: { success: true, output: `${responder.crew.name}: ${content.slice(0, 100)}` }, elapsed: 0 });
      } catch (err) {
        responses.push({ member: responder.crew.name, content: `[Error: ${err instanceof Error ? err.message : 'failed'}]` });
      }
    }

    // If multiple members responded, synthesize
    let synthesized: string | undefined;
    if (responses.length > 1) {
      synthesized = await this.synthesize(userMessage, responses, mainSystemPrompt);
    }

    return { responses, synthesized };
  }

  /**
   * Allow a crew member to ask another crew member a question.
   * This enables inter-crew communication.
   */
  async interCrewMessage(fromId: string, toId: string, message: string, mainSystemPrompt: string): Promise<string> {
    const from = this.members.find(m => m.crew.id === fromId);
    const to = this.members.find(m => m.crew.id === toId);
    if (!from || !to) return '[Member not found]';

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
      const completion = this.provider.complete({
        model: '',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `[From ${from.crew.name}]: ${message}` },
        ],
        temperature: 0.7,
        maxTokens: 2048,
      });

      let content = '';
      for await (const chunk of completion) {
        if (chunk.content) content += chunk.content;
      }

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

  /**
   * Synthesize multiple crew responses into a unified answer.
   */
  private async synthesize(
    userMessage: string,
    responses: Array<{ member: string; content: string }>,
    mainSystemPrompt: string
  ): Promise<string> {
    const responseSummary = responses.map(r => `[${r.member}]:\n${r.content}`).join('\n\n---\n\n');

    const synthesisPrompt = `${mainSystemPrompt}\n\n[ORCHESTRATOR ROLE]\nYou are synthesizing responses from multiple crew members into a cohesive, unified answer.\nDo NOT repeat everything — extract the best insights from each, resolve any conflicts, and present a clear final answer.\nAttribute key insights to the crew member who provided them when relevant.`;

    try {
      const completion = this.provider.complete({
        model: '',
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
      // Fallback: just concatenate
      return responses.map(r => `**${r.member}:**\n${r.content}`).join('\n\n');
    }
  }

  /**
   * Build conversation context for a crew member.
   */
  private buildCrewContext(_member: CrewMember, _currentMessage: string): string {
    // Last 10 messages for context
    const recent = this.conversation.slice(-10);
    if (recent.length === 0) return '';
    return recent.map(m => `[${m.from}]: ${m.content.slice(0, 200)}`).join('\n');
  }

  /**
   * Extract expertise keywords from a system prompt.
   */
  private extractExpertise(systemPrompt: string): string[] {
    const keywords: string[] = [];
    const lower = systemPrompt.toLowerCase();

    // Common expertise domains
    const domains = [
      'frontend', 'backend', 'database', 'devops', 'security', 'testing',
      'design', 'ux', 'ui', 'api', 'architecture', 'mobile', 'cloud',
      'performance', 'infrastructure', 'data', 'ml', 'ai', 'analytics',
      'documentation', 'planning', 'management', 'research', 'review',
      'react', 'vue', 'angular', 'node', 'python', 'rust', 'go',
      'typescript', 'javascript', 'css', 'html', 'sql', 'graphql',
      'docker', 'kubernetes', 'aws', 'gcp', 'azure',
    ];

    for (const domain of domains) {
      if (lower.includes(domain)) keywords.push(domain);
    }

    return keywords;
  }

  private emit(event: Partial<EngineEvent> & { type: string }): void {
    this.eventBus.emit(event as EngineEvent);
  }
}
