import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Agent } from '@agentx/engine';
import type { ChatMessage } from './types';
import type { SessionPersistence } from './SessionPersistence';
import type { ChatViewProvider } from '../webview/ChatViewProvider';

const COMPACTION_THRESHOLD = 0.70;
const MESSAGES_TO_KEEP_RECENT = 10;

export class SessionCompaction {
  private compacting = false;

  constructor(
    private readonly persistence: SessionPersistence,
    private readonly chatView: ChatViewProvider,
  ) {}

  shouldCompact(tokensUsed: number, tokensTotal: number): boolean {
    if (tokensTotal === 0) return false;
    return (tokensUsed / tokensTotal) >= COMPACTION_THRESHOLD;
  }

  async compact(
    sessionId: string,
    messages: ChatMessage[],
    agent: Agent,
  ): Promise<ChatMessage[]> {
    if (this.compacting) {
      return messages;
    }

    if (messages.length <= MESSAGES_TO_KEEP_RECENT + 2) {
      return messages;
    }

    this.compacting = true;

    try {
      this.chatView.postToWebview('compactionStart', {
        message: 'Optimizing session memory...',
      });

      const splitIndex = messages.length - MESSAGES_TO_KEEP_RECENT;
      const olderMessages = messages.slice(0, splitIndex);
      const recentMessages = messages.slice(splitIndex);

      const summary = await this.summarizeMessages(olderMessages, agent);

      const summaryMessage: ChatMessage = {
        id: `compaction-${Date.now()}`,
        sessionId,
        role: 'system',
        content: `[Session Summary — ${olderMessages.length} messages compacted]\n\n${summary}`,
        toolCalls: null,
        tokenCount: 0,
        createdAt: new Date().toISOString(),
      };

      this.writeCompactedContext(sessionId, summary, olderMessages.length);

      const compactedMessages = [summaryMessage, ...recentMessages];

      for (const msg of compactedMessages) {
        this.persistence.persistMessage(sessionId, msg);
      }

      this.chatView.postToWebview('compactionComplete', {
        originalCount: messages.length,
        compactedCount: compactedMessages.length,
        savedMessages: olderMessages.length - 1,
      });

      return compactedMessages;
    } catch (err) {
      this.chatView.postToWebview('error', {
        code: 'COMPACTION_FAILED',
        message: `Session compaction failed: ${err instanceof Error ? err.message : String(err)}`,
        recoverable: true,
      });
      return messages;
    } finally {
      this.compacting = false;
    }
  }

  private async summarizeMessages(messages: ChatMessage[], agent: Agent): Promise<string> {
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content.substring(0, 500)}`)
      .join('\n\n');

    const prompt = `Summarize the following conversation concisely, preserving key decisions, code changes, file paths, and important context. The summary should be detailed enough that the conversation can continue without the original messages.

Conversation:
${conversationText}

Provide a structured summary with sections: Key Decisions, Code Changes, File Paths Referenced, Open Items.`;

    try {
      const msg = await agent.sendMessage(prompt);
      return msg.content || 'Summary unavailable.';
    } catch {
      return this.fallbackSummary(messages);
    }
  }

  private fallbackSummary(messages: ChatMessage[]): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const lines: string[] = [];
    lines.push(`Compacted ${messages.length} messages.`);
    lines.push(`User sent ${userMessages.length} messages.`);

    for (let i = 0; i < Math.min(userMessages.length, 5); i++) {
      const msg = userMessages[i];
      if (msg) {
        const preview = msg.content.substring(0, 100);
        lines.push(`- "${preview}${msg.content.length > 100 ? '...' : ''}"`);
      }
    }

    if (userMessages.length > 5) {
      lines.push(`- ... and ${userMessages.length - 5} more messages`);
    }

    return lines.join('\n');
  }

  private writeCompactedContext(sessionId: string, summary: string, compactedCount: number): void {
    const contextPath = path.join(this.persistence.getSessionDir(sessionId), 'context.txt');
    const tmpPath = contextPath + '.tmp';

    const header = `[${new Date().toISOString()}] COMPACTION: ${compactedCount} messages summarized\n`;
    const content = header + `\n--- Compacted Context ---\n${summary}\n--- End Compacted Context ---\n\n`;

    let existing = '';
    try {
      if (fs.existsSync(contextPath)) {
        existing = fs.readFileSync(contextPath, 'utf-8');
      }
    } catch {
      existing = '';
    }

    fs.writeFileSync(tmpPath, existing + content, 'utf-8');
    fs.renameSync(tmpPath, contextPath);
  }

  isCompacting(): boolean {
    return this.compacting;
  }
}
