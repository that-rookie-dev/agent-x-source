/**
 * DecisionEngine — The brain of Agent-X message routing.
 *
 * Classifies incoming messages and decides:
 * 1. What TYPE of message it is (greeting, conversational, question, task, complex-task)
 * 2. What EXECUTION PATH to take (fast-reply, standard, orchestrated, multi-agent)
 * 3. How much CONTEXT to include (minimal, moderate, full)
 * 4. Whether to DELEGATE to sub-agents
 *
 * This saves tokens by not sending the full 165-tool system prompt for "Hi".
 */

export type MessageClass =
  | 'greeting'        // Hi, Hello, Hey, Good morning
  | 'farewell'        // Bye, See you, Thanks
  | 'conversational'  // Casual chat, follow-ups, acknowledgments
  | 'question'        // What is X? How does Y work? — informational
  | 'simple_task'     // Single-step tasks: "create a file", "run this command"
  | 'complex_task'    // Multi-step tasks: "build a project", "refactor the codebase"
  | 'meta_command'    // Commands to the agent itself: "use GPT-4", "enable plan mode"
  | 'continuation';   // Follows from previous context: "do the same for X", "also add Y"

export type ExecutionPath =
  | 'fast_reply'      // No tools, minimal system prompt, quick response
  | 'standard'        // Normal flow with intent-filtered tools
  | 'orchestrated'    // Plan generation + step-by-step execution
  | 'multi_agent'     // Spawn specialists, parallel execution, merge results
  | 'research';       // Deep research with web search + synthesis

export interface DecisionResult {
  messageClass: MessageClass;
  executionPath: ExecutionPath;
  confidence: number;
  skipRag: boolean;
  skipTools: boolean;
  maxToolCategories: string[];
  suggestedSubAgents: string[];
  tokenBudget: 'minimal' | 'moderate' | 'full';
  reasoning: string;
}

// Patterns for fast classification (no LLM needed)
const GREETING_PATTERNS = /^(hi|hey|hello|howdy|hola|yo|sup|what's up|morning|afternoon|evening|good\s+(morning|afternoon|evening|night)|greetings|namaste)\b/i;
const FAREWELL_PATTERNS = /^(bye|goodbye|see ya|later|thanks|thank you|thx|cheers|take care|good night|gn|ttyl|cya)\b/i;
const CONVERSATIONAL_PATTERNS = /^(ok|okay|sure|got it|i see|nice|cool|great|awesome|understood|makes sense|hmm|alright|yep|yeah|yes|no|nope|nah|right|correct|exactly|indeed|true|fair|interesting)\b/i;
const META_COMMAND_PATTERNS = /^(use |switch |enable |disable |set |change |toggle |activate |configure |show |list |status)/i;
const CONTINUATION_PATTERNS = /^(also |and |then |next |now |plus |additionally |same |similar |do (the same|that|it)|keep going|continue|what about|how about)\b/i;

// Complexity indicators
const HIGH_COMPLEXITY_SIGNALS = [
  'project', 'application', 'app', 'system', 'architecture', 'microservice',
  'refactor', 'redesign', 'rewrite', 'migrate', 'deploy', 'infrastructure',
  'full-stack', 'fullstack', 'end-to-end', 'e2e', 'pipeline', 'workflow',
  'multiple files', 'across the', 'entire', 'whole', 'complete', 'comprehensive',
  'production', 'scalable', 'distributed',
];

const RESEARCH_SIGNALS = [
  'research', 'investigate', 'compare', 'analyze', 'what are the options',
  'pros and cons', 'best practices', 'state of the art', 'latest',
  'differences between', 'alternatives to', 'benchmark',
];

export class DecisionEngine {
  /**
   * Classify a message and decide the execution path.
   * Pure heuristic — no LLM call, no tokens consumed.
   */
  classify(message: string, conversationLength: number = 0): DecisionResult {
    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();
    const wordCount = trimmed.split(/\s+/).length;

    // ─── Fast pattern matching ───
    if (GREETING_PATTERNS.test(trimmed) && wordCount <= 5) {
      return this.result('greeting', 'fast_reply', 0.95, 'Pattern match: greeting');
    }

    if (FAREWELL_PATTERNS.test(trimmed) && wordCount <= 6) {
      return this.result('farewell', 'fast_reply', 0.95, 'Pattern match: farewell/thanks');
    }

    if (CONVERSATIONAL_PATTERNS.test(trimmed) && wordCount <= 4) {
      return this.result('conversational', 'fast_reply', 0.9, 'Pattern match: conversational acknowledgment');
    }

    if (META_COMMAND_PATTERNS.test(trimmed)) {
      return this.result('meta_command', 'standard', 0.85, 'Pattern match: meta command');
    }

    if (CONTINUATION_PATTERNS.test(trimmed) && conversationLength > 0) {
      return this.result('continuation', 'standard', 0.8, 'Pattern match: continuation of previous');
    }

    // ─── Complexity analysis ───
    const complexityScore = this.measureComplexity(lower, wordCount);
    const isResearch = RESEARCH_SIGNALS.some(s => lower.includes(s));

    if (isResearch && complexityScore >= 2) {
      return this.result('complex_task', 'research', 0.8, `Research task (complexity: ${complexityScore})`);
    }

    if (complexityScore >= 4) {
      return this.result('complex_task', 'multi_agent', 0.85, `High complexity (${complexityScore}) — multi-agent delegation`);
    }

    if (complexityScore >= 2) {
      return this.result('complex_task', 'orchestrated', 0.75, `Medium complexity (${complexityScore}) — orchestrated execution`);
    }

    // ─── Question vs Task ───
    const isQuestion = this.isQuestion(lower, trimmed);
    if (isQuestion && wordCount <= 15) {
      return this.result('question', 'standard', 0.7, 'Detected as informational question');
    }

    if (wordCount <= 8 && !this.hasActionVerb(lower)) {
      return this.result('question', 'standard', 0.6, 'Short message, likely question/clarification');
    }

    // Default: treat as simple task
    return this.result('simple_task', 'standard', 0.6, 'Default: simple task execution');
  }

  /**
   * For messages classified as needing LLM help to understand (ambiguous/complex),
   * generate a lightweight classification prompt. This is the "ask model to understand" step.
   */
  buildClassificationPrompt(message: string): string {
    return [
      'Classify this user message into exactly ONE category. Respond with ONLY the category name, nothing else.',
      '',
      'Categories:',
      '- greeting (casual hello/hi)',
      '- farewell (bye/thanks)',
      '- conversational (acknowledgment, follow-up)',
      '- question (asking for information)',
      '- simple_task (single action: create file, run command, fix bug)',
      '- complex_task (multi-step: build project, refactor system, design architecture)',
      '- meta_command (configure agent settings)',
      '- continuation (follows from previous message)',
      '',
      `Message: "${message}"`,
      '',
      'Category:',
    ].join('\n');
  }

  /**
   * Build a minimal system prompt for fast-reply path (greetings, conversational).
   * No tools, no RAG, just personality.
   */
  buildFastReplyPrompt(sauceIdentity: string): string {
    return `You are a helpful AI assistant.
${sauceIdentity ? `\n${sauceIdentity}` : ''}
Keep responses friendly, concise, and natural. No tools, no code, no markdown unless needed.`;
  }

  private measureComplexity(lower: string, wordCount: number): number {
    let score = 0;

    // Word count contributes to complexity
    if (wordCount > 30) score += 2;
    else if (wordCount > 15) score += 1;

    // High-complexity signal words
    for (const signal of HIGH_COMPLEXITY_SIGNALS) {
      if (lower.includes(signal)) score += 1;
    }

    // Multiple action verbs suggest multi-step
    const actionVerbs = ['create', 'build', 'write', 'implement', 'set up', 'configure', 'deploy', 'test', 'fix', 'update', 'add', 'remove', 'install'];
    const verbCount = actionVerbs.filter(v => lower.includes(v)).length;
    if (verbCount >= 3) score += 2;
    else if (verbCount >= 2) score += 1;

    // Conjunctions suggest multi-step
    const conjunctions = (lower.match(/\b(and|then|also|plus|after that|finally|next)\b/g) || []).length;
    if (conjunctions >= 2) score += 1;

    // Numbered lists or bullet points
    if (/\d+[.)\s]/.test(lower) || /[-*]\s/.test(lower)) score += 1;

    return score;
  }

  private isQuestion(lower: string, original: string): boolean {
    if (original.endsWith('?')) return true;
    if (/^(what|how|why|when|where|who|which|can|could|would|is|are|do|does|will|should)\b/.test(lower)) return true;
    return false;
  }

  private hasActionVerb(lower: string): boolean {
    const actions = ['create', 'build', 'write', 'make', 'generate', 'implement', 'fix', 'update', 'delete', 'remove', 'install', 'deploy', 'run', 'execute', 'start', 'stop', 'send', 'move', 'copy'];
    return actions.some(a => lower.includes(a));
  }

  private result(
    messageClass: MessageClass,
    executionPath: ExecutionPath,
    confidence: number,
    reasoning: string,
  ): DecisionResult {
    const skipRag = executionPath === 'fast_reply';
    const skipTools = executionPath === 'fast_reply';

    const tokenBudget: DecisionResult['tokenBudget'] =
      executionPath === 'fast_reply' ? 'minimal' :
      executionPath === 'multi_agent' || executionPath === 'research' ? 'full' :
      'moderate';

    const suggestedSubAgents: string[] = [];
    if (executionPath === 'multi_agent') {
      suggestedSubAgents.push('planner', 'executor', 'reviewer');
    } else if (executionPath === 'research') {
      suggestedSubAgents.push('researcher', 'synthesizer');
    }

    // Tool categories for standard path
    const maxToolCategories: string[] = [];
    if (messageClass === 'simple_task' || messageClass === 'complex_task') {
      maxToolCategories.push('System', 'Filesystem', 'Code Intelligence', 'Git & VCS');
    }
    if (messageClass === 'question') {
      maxToolCategories.push('Web & Network', 'Documents');
    }

    return {
      messageClass,
      executionPath,
      confidence,
      skipRag,
      skipTools,
      maxToolCategories,
      suggestedSubAgents,
      tokenBudget,
      reasoning,
    };
  }
}
