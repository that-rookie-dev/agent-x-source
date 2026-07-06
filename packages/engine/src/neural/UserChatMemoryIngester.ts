/**
 * Global user-profile memory ingester for Agent-X super-session chat.
 *
 * Extracts user-relevant facts (identity, preferences, instructions, projects)
 * from conversation turns and stores them in MemoryFabric as vector-indexed
 * nodes tagged `user_profile`. These nodes are session-scoped NULL so they
 * are shared across all chat sessions via GraphRAG retrieval.
 */
import type { CompletionMessage } from '@agentx/shared';
import type { EmbeddingProvider } from '@agentx/shared';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { getLogger } from '@agentx/shared';
import type { MemoryFabric } from './MemoryFabric.js';

export const USER_PROFILE_TAG = 'user_profile';

export interface UserChatMemoryFact {
  label: string;
  content: string;
  category: string;
}

const EXTRACTION_PROMPT = `You are a user memory extraction system. Analyze the user message and assistant reply for facts about THE USER that should persist across all future conversations.

Extract ONLY:
- Personal identity (name, role, location, employer)
- Preferences (languages, tools, styles, communication)
- Standing instructions ("always do X", "never do Y", "from now on")
- Project/context facts the user shares about their work or life
- Explicit "remember this" requests from the user

Do NOT extract:
- General knowledge, news, or web search results the assistant looked up
- Temporary task details unless the user asks to remember them
- Assistant-generated analysis or summaries of external content
- Facts about third parties unless the user explicitly ties them to themselves

If the user says "remember" about specific information (including web results), extract that as a user memory.

If nothing is worth remembering, respond with exactly: NONE

Otherwise respond with one memory per line:
[category] label | content

Categories: identity, preference, instruction, project, context
- label = short title (max 80 chars)
- content = one concise sentence the agent should recall later`;

/**
 * Heuristic gate — skip LLM when the user message is unlikely to contain profile facts.
 */
export function shouldExtractUserChatMemory(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  const triggers = [
    'my name', 'call me', 'i am', "i'm", 'remember',
    'i prefer', 'i like', 'i use', 'i work', 'i live',
    "don't call", 'always', 'never', 'from now on',
    'i want you to', 'keep in mind', 'note that',
    'my project', 'my team', 'my company', 'my stack',
    'i go by', 'refer to me', 'address me',
    'your name', 'you are called', 'be called', 'call you',
    'i need you to know', 'for context', 'just so you know',
    'i usually', 'i typically', 'my goal', 'my role',
  ];
  return triggers.some((t) => lower.includes(t));
}

function parseExtraction(response: string): UserChatMemoryFact[] {
  if (!response || response.trim() === 'NONE') return [];
  const facts: UserChatMemoryFact[] = [];
  for (const line of response.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[(\w+)\]\s*(.+?)\s*\|\s*(.+)$/);
    if (match) {
      facts.push({
        category: match[1]!,
        label: match[2]!.trim().slice(0, 80),
        content: match[3]!.trim(),
      });
      continue;
    }
    // Fallback: [category] content (no label pipe)
    const fallback = trimmed.match(/^\[(\w+)\]\s*(.+)$/);
    if (fallback) {
      const content = fallback[2]!.trim();
      facts.push({
        category: fallback[1]!,
        label: content.slice(0, 80),
        content,
      });
    }
  }
  return facts;
}

export class UserChatMemoryIngester {
  private pending = 0;
  private readonly maxConcurrent = 2;

  constructor(
    private fabric: MemoryFabric,
    private embedder: EmbeddingProvider,
    private provider: ProviderInterface,
    private model: string,
  ) {}

  /**
   * Extract and persist user-profile memories from a conversation turn.
   * Non-blocking — callers should fire-and-forget.
   */
  async ingestTurn(userMessage: string, assistantResponse: string, sourceSessionId: string): Promise<number> {
    if (!shouldExtractUserChatMemory(userMessage)) return 0;
    if (this.pending >= this.maxConcurrent) return 0;

    this.pending++;
    try {
      const facts = await this.extractFacts(userMessage, assistantResponse);
      if (facts.length === 0) return 0;

      let stored = 0;
      for (const fact of facts) {
        try {
          const text = `${fact.label}: ${fact.content}`;
          const embedding = await this.embedder.embed(text);
          await this.fabric.createNode({
            label: fact.label,
            category: 'semantic',
            content: fact.content,
            embedding,
            tag: USER_PROFILE_TAG,
            sessionId: undefined,
            confidence: 0.92,
            provenance: {
              memoryCategory: fact.category,
              sourceSessionId,
              ingestedAt: new Date().toISOString(),
            },
          });
          stored++;
        } catch (e) {
          getLogger().warn('USER_CHAT_MEMORY', `Failed to store fact "${fact.label}": ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (stored > 0) {
        getLogger().info('USER_CHAT_MEMORY', `Stored ${stored} user-profile memory node(s) from session ${sourceSessionId.slice(0, 8)}`);
      }
      return stored;
    } finally {
      this.pending--;
    }
  }

  private async extractFacts(userMessage: string, assistantResponse: string): Promise<UserChatMemoryFact[]> {
    const messages: CompletionMessage[] = [
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `User said: "${userMessage}"\n\nAssistant replied: "${assistantResponse.slice(0, 800)}"`,
      },
    ];

    let result = '';
    try {
      for await (const chunk of this.provider.complete({
        model: this.model,
        messages,
        maxTokens: 300,
        temperature: 0,
      })) {
        if (chunk.content) result += chunk.content;
      }
    } catch (e) {
      getLogger().warn('USER_CHAT_MEMORY', `Extraction LLM failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }

    return parseExtraction(result.trim());
  }
}
