import type { CompletionMessage, ToolSchema } from '@agentx/shared';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface PromptBudget {
  total: number;
  system: number;
  rag: number;
  memory: number;
  conversation: number;
  response: number;
}

export interface IntentResult {
  intent: 'code' | 'research' | 'file_system' | 'communication' | 'analysis' | 'creative' | 'general';
  confidence: number;
  relevantToolCategories: string[];
  reasoningMode: 'quick' | 'deep' | 'creative' | 'tree';
}

/**
 * Token-efficient prompt engineering engine.
 * Dynamically assembles system prompts based on intent, budget, and context.
 */
export class PromptEngine {
  private contextWindow: number;
  private safetyBuffer = 2048; // Reserve tokens for response + overhead

  constructor(contextWindow: number) {
    this.contextWindow = contextWindow;
  }

  /**
   * Detect intent from a user message using lightweight heuristics.
   * No LLM call required — fast and token-free.
   */
  detectIntent(message: string): IntentResult {
    const lower = message.toLowerCase();
    const words = new Set(lower.split(/\s+/));

    const signals: Record<IntentResult['intent'], string[]> = {
      code: ['code', 'function', 'class', 'bug', 'fix', 'refactor', 'implement', 'write', 'create', 'test', 'debug', 'error', 'compile', 'build', 'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'api', 'endpoint', 'database', 'schema', 'migration'],
      research: ['search', 'find', 'lookup', 'research', 'investigate', 'explore', 'compare', 'what is', 'how does', 'why', 'explain', 'document', 'wiki', 'article'],
      file_system: ['file', 'folder', 'directory', 'read', 'write', 'delete', 'move', 'copy', 'list', 'path', 'create', 'open', 'save', 'export', 'import'],
      communication: ['send', 'message', 'email', 'telegram', 'discord', 'slack', 'notify', 'remind', 'ping', 'alert', 'schedule', 'meeting'],
      analysis: ['analyze', 'review', 'check', 'audit', 'inspect', 'evaluate', 'assess', 'performance', 'metrics', 'data', 'report', 'summary', 'stats'],
      creative: ['design', 'draw', 'image', 'generate', 'create', 'write', 'story', 'poem', 'compose', 'draft', 'brainstorm', 'idea'],
      general: [],
    };

    let bestIntent: IntentResult['intent'] = 'general';
    let bestScore = 0;
    const matchedCategories: string[] = [];

    for (const [intent, keywords] of Object.entries(signals)) {
      const score = keywords.reduce((acc, kw) => acc + (words.has(kw) || lower.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent as IntentResult['intent'];
      }
      if (score > 0) matchedCategories.push(intent);
    }

    // If no strong signal, default to general
    if (bestScore === 0) {
      bestIntent = 'general';
    }

    const confidence = Math.min(bestScore / 3, 1);

    // Map intent to tool categories
    const categoryMap: Record<IntentResult['intent'], string[]> = {
      code: ['Code Intelligence', 'Git & VCS', 'Testing', 'System'],
      research: ['Web & Network', 'Documents', 'Data Processing', 'AI Meta-Tools'],
      file_system: ['Filesystem', 'Documents', 'Archive'],
      communication: ['Communication', 'Scheduler', 'Telegram'],
      analysis: ['Code Intelligence', 'Data Processing', 'System', 'AI Meta-Tools'],
      creative: ['Documents', 'Media', 'Image', 'AI Meta-Tools'],
      general: [],
    };

    // Always include core categories
    const relevantCategories = new Set([
      'System',
      'Communication',
      ...categoryMap[bestIntent],
    ]);

    // Detect tree-of-thoughts triggers
    const treeTriggers = ['tree of thoughts', 'explore multiple paths', 'consider alternatives', 'brainstorm approaches', 'evaluate options'];
    const reasoningMode: IntentResult['reasoningMode'] =
      treeTriggers.some((t) => lower.includes(t))
        ? 'tree'
        : bestIntent === 'analysis' || bestIntent === 'research'
          ? 'deep'
          : bestIntent === 'creative'
            ? 'creative'
            : 'quick';

    return {
      intent: bestIntent,
      confidence,
      relevantToolCategories: [...relevantCategories],
      reasoningMode,
    };
  }

  /**
   * Build token budget allocation for the current conversation state.
   */
  calculateBudget(
    messageCount: number,
    hasRagResults: boolean,
  ): PromptBudget {
    const available = this.contextWindow - this.safetyBuffer;

    // As conversation grows, shift budget from memories to conversation
    const conversationRatio = Math.min(messageCount / 20, 1); // 0→1 as messages grow

    const systemMax = Math.min(6000, available * 0.15);
    const ragMax = hasRagResults ? Math.min(4000, available * 0.1) : 0;
    const memoryMax = Math.floor((available * 0.15) * (1 - conversationRatio * 0.5));
    const conversationMax = Math.floor((available * 0.55) + (available * 0.1) * conversationRatio);
    const responseReserve = available - systemMax - ragMax - memoryMax - conversationMax;

    return {
      total: available,
      system: systemMax,
      rag: ragMax,
      memory: memoryMax,
      conversation: conversationMax,
      response: Math.max(responseReserve, 2000),
    };
  }

  /**
   * Select only relevant tools based on intent, reducing token usage.
   * Falls back to all tools if confidence is low.
   */
  selectTools(
    allTools: ToolSchema[],
    intent: IntentResult,
    toolCategories: Map<string, string>, // toolId -> category
  ): ToolSchema[] {
    if (intent.intent === 'general' || intent.confidence < 0.3) {
      return allTools;
    }

    const relevant = allTools.filter((t) => {
      const cat = toolCategories.get(t.function.name);
      if (!cat) return true; // Keep uncategorized tools
      return intent.relevantToolCategories.includes(cat);
    });

    // Always keep at least 20 tools + all uncategorized
    if (relevant.length < 20) {
      const relevantNames = new Set(relevant.map((t) => t.function.name));
      const extras = allTools.filter((t) => !relevantNames.has(t.function.name)).slice(0, 20 - relevant.length);
      return [...relevant, ...extras];
    }

    logger.info('PROMPT_ENGINE', `Filtered ${allTools.length} → ${relevant.length} tools for intent: ${intent.intent}`);
    return relevant;
  }

  /**
   * Build reasoning directive based on mode.
   */
  buildReasoningDirective(mode: IntentResult['reasoningMode']): string {
    switch (mode) {
      case 'deep':
        return `[REASONING]\nUse step-by-step reasoning. Break complex problems into smaller parts. Verify assumptions. Consider edge cases and alternatives before concluding.\n[/REASONING]`;
      case 'creative':
        return `[REASONING]\nExplore multiple approaches. Be imaginative and unconventional. Combine ideas from different domains. Prioritize novelty and insight over speed.\n[/REASONING]`;
      case 'tree':
        return `[REASONING]\nTree of Thoughts mode activated. The agent will explore multiple reasoning paths, evaluate them, and expand the most promising ones.\n[/REASONING]`;
      case 'quick':
        return `[REASONING]\nBe concise and direct. Use first-principles thinking for simple problems. Minimize explanation unless asked.\n[/REASONING]`;
    }
  }

  /**
   * Build RAG context from search results.
   */
  buildRagContext(results: Array<{ content: string; score?: number; metadata?: Record<string, unknown> }>): string {
    if (results.length === 0) return '';

    const parts = results.map((r, i) => {
      const sourceName =
        (r.metadata?.['sourceName'] as string | undefined) ||
        (r.metadata?.['source'] as string | undefined) ||
        (r.metadata?.['docId'] as string | undefined) ||
        `doc-${i}`;
      const page = r.metadata?.['pageNumber'];
      const kind = r.metadata?.['kind'];
      const label = [
        sourceName,
        kind ? String(kind) : null,
        page != null ? `p.${page}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const body = r.content.length > 2800 ? `${r.content.slice(0, 2800)}…` : r.content;
      return `[${label}]\n${body}`;
    });

    return `[RELEVANT_DOCUMENTS]\nThe following knowledge-base / indexed excerpts may help answer the user's query. Prefer body text over table-of-contents lines. For more depth, call knowledge_base_search with a precise query.\n\n${parts.join('\n\n')}\n[/RELEVANT_DOCUMENTS]`;
  }

  /**
   * Estimate token count from text (rough approximation: 1 token ≈ 4 chars for English).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Compact conversation history when approaching token limit.
   * Uses structured compression: groups messages by topic cluster,
   * keeps key decisions/files/facts, and produces a structured summary.
   */
  compactConversation(
    messages: CompletionMessage[],
    budget: number,
  ): { summary?: string; messages: CompletionMessage[] } {
    let total = 0;
    for (const m of messages) {
      total += this.estimateTokens(m.content);
    }

    if (total <= budget) {
      return { messages };
    }

    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    if (nonSystem.length <= 8) {
      return { messages };
    }

    // Keep last 8 messages for immediate context
    const recent = nonSystem.slice(-8);
    const older = nonSystem.slice(0, -8);

    // Structured summary extraction: group by topic signals
    const clusters: Array<{ topic: string; facts: string[]; decisions: string[]; files: string[] }> = [];
    let currentCluster: { topic: string; facts: string[]; decisions: string[]; files: string[] } | null = null;

    for (const msg of older) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (!content.trim()) continue;

      // Detect topic transitions (code blocks, file paths, decision keywords)
      const topicSignals = content.match(/### .+|## .+|^# .+|^(Project|Architecture|Design|Implementation|Task|Goal|Plan):/m);
      const mentionedFiles = content.match(/[\w./-]+\.(?:ts|js|tsx|jsx|py|rs|go|json|md|css|scss|html|vue|svelte)\b/g);
      const hasDecision = /^(approved|rejected|decided|chosen|selected|going with|will use)/im.test(content.trim()) ||
        /(?:we|I|let's)\s+(?:use|pick|choose|go with|implement|adopt)/i.test(content);

      if (topicSignals || !currentCluster) {
        if (currentCluster) clusters.push(currentCluster);
        currentCluster = {
          topic: topicSignals ? topicSignals[1] || content.slice(0, 60) : content.slice(0, 60),
          facts: [],
          decisions: [],
          files: [],
        };
      }

      if (hasDecision) {
        const decisionText = content.match(/(?:we|I|let's)\s+(?:use|pick|choose|go with|implement|adopt)[^.]*\./i);
        if (decisionText && currentCluster) currentCluster.decisions.push(decisionText[0]);
      }

      if (mentionedFiles && currentCluster) {
        for (const f of mentionedFiles) {
          if (!currentCluster.files.includes(f)) currentCluster.files.push(f);
        }
      }

      if (currentCluster) {
        const keyInfo = this.extractKeyFacts(content);
        currentCluster.facts.push(...keyInfo);
      }
    }

    if (currentCluster) clusters.push(currentCluster);

    // Build structured summary
    const summaryParts: string[] = ['[CONVERSATION_SUMMARY]'];
    for (const cluster of clusters) {
      const uniqueFacts = [...new Set(cluster.facts)].slice(0, 5);
      const uniqueDecisions = [...new Set(cluster.decisions)].slice(0, 3);
      const uniqueFiles = [...new Set(cluster.files)].slice(0, 10);

      if (uniqueFacts.length === 0 && uniqueDecisions.length === 0 && uniqueFiles.length === 0) continue;

      summaryParts.push(`\n## ${cluster.topic.slice(0, 80)}`);
      if (uniqueFacts.length > 0) {
        summaryParts.push(`Facts: ${uniqueFacts.join('; ')}`);
      }
      if (uniqueDecisions.length > 0) {
        summaryParts.push(`Decisions: ${uniqueDecisions.join('; ')}`);
      }
      if (uniqueFiles.length > 0) {
        summaryParts.push(`Files: ${uniqueFiles.join(', ')}`);
      }
    }
    summaryParts.push('[/CONVERSATION_SUMMARY]');

    const summary = summaryParts.join('\n');

    return {
      summary,
      messages: [...systemMessages, { role: 'system' as const, content: summary }, ...recent],
    };
  }

  /**
   * Extract key facts from a message using lightweight heuristics.
   */
  private extractKeyFacts(content: string): string[] {
    const facts: string[] = [];

    // Extract file creation/modification facts
    const fileOps = content.match(/(?:created|modified|wrote|updated|added|generated|deleted|renamed)\s+["']?([\w./-]+)["']?/gi);
    if (fileOps) facts.push(...fileOps.slice(0, 5));

    // Extract dependency/import decisions
    const deps = content.match(/(?:installed|added|using|imported)\s+(?:package|module|library|dependency)\s+["']?([\w@/-]+)["']?/gi);
    if (deps) facts.push(...deps.slice(0, 3));

    // Extract version/path/URL facts
    const urls = content.match(/https?:\/\/[^\s,)]+/g);
    if (urls) facts.push(`Referenced: ${urls.slice(0, 3).join(', ')}`);

    // Extract errors encountered
    const errors = content.match(/(?:Error|Failed|Exception|Timeout|Crash):\s*[^\n]{10,100}/g);
    if (errors) facts.push(...errors.slice(0, 3).map(e => `Error: ${e.slice(0, 80)}`));

    return facts.map(f => f.trim()).filter(f => f.length > 5);
  }
}
