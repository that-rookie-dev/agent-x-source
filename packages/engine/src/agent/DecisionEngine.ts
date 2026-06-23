/**
 * DecisionEngine — Hybrid classifier with fast-path cache.
 *
 * Short, unambiguous messages (greetings, farewells, acknowledgments)
 * are pattern-matched to skip the LLM entirely — saving tokens and latency.
 * Everything else goes to the LLM with all tools — the LLM understands
 * slang, sentiment, regional variations, and complex intent natively.
 *
 * No complexity scoring. No action verb lists. No research signals.
 * The LLM handles classification for 99% of messages.
 */
export type MessageClass = 'greeting' | 'farewell' | 'conversational' | 'task';
export type ExecutionPath = 'fast_reply' | 'standard';

export interface DecisionResult {
  messageClass: MessageClass;
  executionPath: ExecutionPath;
  confidence: number;
  skipRag: boolean;
  skipTools: boolean;
  tokenBudget: 'minimal' | 'moderate';
  reasoning: string;
}

// Fast-path cache — only the most unambiguous patterns.
// If a pattern fails to match, the LLM handles it.
const GREETING = /^(hi|hey|hello|howdy|hola|yo|sup|what's up|morning|afternoon|evening|good\s+(morning|afternoon|evening|night)|greetings|namaste)\b/i;
const FAREWELL = /^(bye|goodbye|see ya|later|thanks|thank you|thx|cheers|take care|good night|gn|ttyl|cya)\b/i;
const ACK = /^(ok|okay|sure|got it|i see|nice|cool|great|awesome|understood|makes sense|hmm|alright|yep|yeah|yes|no|nope|nah|right|correct|exactly|indeed|true|fair|interesting)\b/i;

export class DecisionEngine {
  classify(message: string, _conversationLength: number = 0): DecisionResult {
    const trimmed = message.trim();
    const words = trimmed.split(/\s+/).length;

    // Fast-path cache — tokens saved, latency avoided
    if (GREETING.test(trimmed) && words <= 5)
      return this.result('greeting', 'fast_reply', 'Pattern: greeting');
    if (FAREWELL.test(trimmed) && words <= 6)
      return this.result('farewell', 'fast_reply', 'Pattern: farewell');
    if (ACK.test(trimmed) && words <= 4)
      return this.result('conversational', 'fast_reply', 'Pattern: ack');

    // LLM decides — understands "yo what up fam", "heya mate", any language
    return this.result('task', 'standard', 'LLM decides');
  }

  buildClassificationPrompt(_message: string): string { return ''; }

  buildFastReplyPrompt(identity: string): string {
    return `${identity ? `${identity}\n\n` : ''}Be friendly, concise, natural. No tools, no code.`;
  }

  suggestCrewComposition(task: string): Array<{ role: string; reason: string }> {
    const l = task.toLowerCase();
    if (l.includes('api') || l.includes('backend')) return [{ role: 'Backend Dev', reason: 'API' }, { role: 'QA', reason: 'Verify' }];
    if (l.includes('bug') || l.includes('fix') || l.includes('debug')) return [{ role: 'Debugger', reason: 'Bug' }];
    return [{ role: 'Generalist', reason: 'Default' }];
  }

  private result(cls: MessageClass, path: ExecutionPath, reasoning: string): DecisionResult {
    const fast = path === 'fast_reply';
    return { messageClass: cls, executionPath: path, confidence: 0.95, skipRag: fast, skipTools: fast, tokenBudget: fast ? 'minimal' : 'moderate', reasoning };
  }
}
