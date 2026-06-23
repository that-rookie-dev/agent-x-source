import { getLogger } from '@agentx/shared';
import type { Agent } from './Agent.js';

const logger = getLogger();

export interface ReflectionResult {
  whatWorked: string[];
  whatDidnt: string[];
  suggestions: string[];
  improvedPrompt?: string;
}

/**
 * After task completion, the agent reflects on what worked
 * and what didn't, then updates its own system prompt for
 * continuous self-improvement.
 */
export class ReflectionLoop {
  private reflectionHistory: Array<{ task: string; result: ReflectionResult; timestamp: number }> = [];
  private maxHistory = 50;

  /**
   * Run a reflection on the completed task.
   */
  async reflect(
    agent: Agent,
    task: string,
    toolCallsUsed: Array<{ name: string; success: boolean; output: string; elapsed: number }>,
    finalResponse: string,
  ): Promise<ReflectionResult | null> {
    // Only reflect on substantial tasks (2+ tool calls)
    if (toolCallsUsed.length < 2) return null;

    const prov = (agent as unknown as { provider: { complete: (req: unknown) => AsyncIterable<Record<string, unknown>> } }).provider;
    if (!prov) return null;

    const model = (agent as unknown as { config: { provider: { activeModel: string } } }).config?.provider?.activeModel ?? 'gpt-4o-mini';

    const toolSummary = toolCallsUsed.map((t) =>
      `${t.name}: ${t.success ? 'SUCCESS' : 'FAILURE'} (${t.elapsed}ms) — ${t.output.slice(0, 100)}`
    ).join('\n');

    const reflectionPrompt = `You completed this task: "${task.slice(0, 300)}"

Tools used:
${toolSummary}

Your response: "${finalResponse.slice(0, 500)}"

Reflect on this task. Answer these 3 sections:

[WHAT_WORKED]
List what went well (tools, approach, reasoning).

[WHAT_DIDNT]
List what could have been better (errors, inefficiencies, wrong tools).

[SUGGESTIONS]
Concrete improvements for next time. Include specific tool choices or prompt changes.

[IMPROVED_PROMPT]
Write a one-sentence improved system instruction for this type of task.`;

    try {
      let reflectionText = '';
      const stream = prov.complete({
        messages: [{ role: 'user', content: reflectionPrompt }],
        model,
        maxTokens: 800,
        stream: true,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.content) reflectionText += String(chunk.content);
      }

      const result = this.parseReflection(reflectionText);

      // Store in history
      this.reflectionHistory.push({ task, result, timestamp: Date.now() });
      if (this.reflectionHistory.length > this.maxHistory) {
        this.reflectionHistory.shift();
      }

      // Emit event
      (agent as unknown as { events: { emit: (event: unknown) => void } }).events.emit({
        type: 'reflection_complete',
        result,
      });

      return result;
    } catch (e) {
      logger.warn('REFLECTION', `Reflection failed: ${e}`);
      return null;
    }
  }

  /**
   * Get cumulative learnings from history to inject into system prompt.
   */
  getCumulativeLearnings(): string {
    if (this.reflectionHistory.length === 0) return '';

    const suggestions = this.reflectionHistory
      .flatMap((r) => r.result.suggestions)
      .filter((s) => s.length > 0);

    if (suggestions.length === 0) return '';

    // Take last 10 unique suggestions
    const unique = [...new Set(suggestions)].slice(-10);

    return `[LEARNINGS]\nBased on previous tasks, here are proven strategies:\n${unique.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n[/LEARNINGS]`;
  }

  /**
   * Find the best approach from past reflection history for a similar task.
   * Uses keyword matching to score relevance of past task patterns.
   * Returns an actionable directive or empty string.
   */
  getBestApproach(currentTask: string): string {
    if (this.reflectionHistory.length === 0) return '';

    const taskWords = new Set(currentTask.toLowerCase().split(/\s+/).filter(w => w.length > 3));

    // Score each past reflection by keyword overlap with current task
    const scored = this.reflectionHistory.map(r => {
      const pastWords = r.task.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap = pastWords.filter(w => taskWords.has(w)).length;
      const recency = 1 - (Date.now() - r.timestamp) / (7 * 86400000); // decay over 7 days
      return { ...r, score: overlap * 2 + Math.max(0, recency) * 3 };
    });

    scored.sort((a, b) => b.score - a.score);

    const best = scored.filter(s => s.score >= 3).slice(0, 3);

    if (best.length === 0) return '';

    const directives: string[] = [];
    const seenDirectives = new Set<string>();

    for (const b of best) {
      // Extract "what worked" as prescriptive guidance
      for (const w of b.result.whatWorked) {
        if (!seenDirectives.has(w) && w.length > 5) {
          seenDirectives.add(w);
          directives.push(`Previously effective: ${w}`);
        }
      }
      // Extract concrete suggestions
      for (const s of b.result.suggestions) {
        if (!seenDirectives.has(s) && s.length > 5) {
          seenDirectives.add(s);
          directives.push(`Proven strategy: ${s}`);
        }
      }
    }

    if (directives.length === 0) return '';

    return `[MEMORY_DRIVEN]\nFrom past experience with similar tasks:\n${directives.map(d => `- ${d}`).join('\n')}\nPrefer these proven approaches over untried alternatives.\n[/MEMORY_DRIVEN]`;
  }

  getHistory(): Array<{ task: string; result: ReflectionResult; timestamp: number }> {
    return [...this.reflectionHistory];
  }

  private parseReflection(text: string): ReflectionResult {
    const sections = {
      whatWorked: [] as string[],
      whatDidnt: [] as string[],
      suggestions: [] as string[],
      improvedPrompt: undefined as string | undefined,
    };

    const extractSection = (content: string, header: string): string[] => {
      const regex = new RegExp(`\\[${header}\\][^[]*`, 'i');
      const match = content.match(regex);
      if (!match) return [];
      return match[0]
        .replace(new RegExp(`\\[${header}\\]`, 'i'), '')
        .trim()
        .split('\n')
        .map((l: string) => l.replace(/^[-\d.]+\s*/, '').trim())
        .filter((l: string) => l.length > 3);
    };

    sections.whatWorked = extractSection(text, 'WHAT_WORKED');
    sections.whatDidnt = extractSection(text, 'WHAT_DIDNT');
    sections.suggestions = extractSection(text, 'SUGGESTIONS');

    const improvedMatch = text.match(/\[IMPROVED_PROMPT\]([^[]*)/i);
    if (improvedMatch?.[1]) {
      sections.improvedPrompt = improvedMatch[1].trim().replace(/^[-:]\s*/, '');
    }

    return sections;
  }
}
