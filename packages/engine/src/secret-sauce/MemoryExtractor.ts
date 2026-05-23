import type { CompletionMessage } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';

interface ExtractedMemory {
  content: string;
  category: string;
}

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the last user message and assistant response for facts worth remembering across sessions.

Extract ONLY explicit personal facts, preferences, instructions, or corrections the user stated. Examples:
- "My name is Alex" → category: identity, content: "User's name is Alex"
- "I prefer TypeScript" → category: preference, content: "User prefers TypeScript"
- "Call me Bob" → category: identity, content: "User wants to be called Bob"
- "I work at Google" → category: identity, content: "User works at Google"
- "Remember that my project uses React" → category: project, content: "User's project uses React"

Do NOT extract:
- General knowledge questions/answers
- Coding questions without personal context
- Temporary task-related info
- Things already obvious from context

If there is nothing worth remembering, respond with: NONE

Otherwise respond with one memory per line in format:
[category] content

Categories: identity, preference, instruction, project, context`;

/**
 * Extracts memorable facts from conversation exchanges.
 * Uses a lightweight LLM call to identify facts worth persisting.
 */
export class MemoryExtractor {
  private provider: ProviderInterface;
  private model: string;
  private pendingExtractions = 0;
  private maxConcurrent = 1;

  constructor(provider: ProviderInterface, model: string) {
    this.provider = provider;
    this.model = model;
  }

  /**
   * Determines if the user message likely contains memorable information.
   * Quick heuristic to avoid unnecessary LLM calls.
   */
  private shouldExtract(userMessage: string): boolean {
    const lower = userMessage.toLowerCase();

    // Triggers that suggest memorable content
    const triggers = [
      'my name', 'call me', 'i am', "i'm", 'remember',
      'i prefer', 'i like', 'i use', 'i work', 'i live',
      'don\'t call', 'always', 'never', 'from now on',
      'i want you to', 'keep in mind', 'note that',
      'my project', 'my team', 'my company', 'my stack',
      'i go by', 'refer to me', 'address me',
    ];

    return triggers.some((t) => lower.includes(t));
  }

  /**
   * Extract memories from the last exchange.
   * Returns extracted memories or empty array.
   */
  async extract(
    userMessage: string,
    assistantResponse: string,
  ): Promise<ExtractedMemory[]> {
    // Quick check - skip if unlikely to contain memorable info
    if (!this.shouldExtract(userMessage)) {
      return [];
    }

    // Rate limit concurrent extractions
    if (this.pendingExtractions >= this.maxConcurrent) {
      return [];
    }

    this.pendingExtractions++;
    try {
      const messages: CompletionMessage[] = [
        { role: 'system', content: EXTRACTION_PROMPT },
        {
          role: 'user',
          content: `User said: "${userMessage}"\n\nAssistant replied: "${assistantResponse.slice(0, 500)}"`,
        },
      ];

      let result = '';
      for await (const chunk of this.provider.complete({
        model: this.model,
        messages,
        maxTokens: 200,
        temperature: 0,
      })) {
        if (chunk.content) result += chunk.content;
      }

      return this.parseExtraction(result.trim());
    } catch {
      // Silently fail - memory extraction is best-effort
      return [];
    } finally {
      this.pendingExtractions--;
    }
  }

  private parseExtraction(response: string): ExtractedMemory[] {
    if (!response || response.trim() === 'NONE') return [];

    const memories: ExtractedMemory[] = [];
    const lines = response.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      const match = line.match(/^\[(\w+)\]\s*(.+)$/);
      if (match) {
        memories.push({
          category: match[1]!,
          content: match[2]!.trim(),
        });
      }
    }

    return memories;
  }
}
