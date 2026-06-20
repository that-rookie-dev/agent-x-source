import { randomUUID } from 'node:crypto';
import type { NormalizedToolCall } from '@agentx/shared';
import { ToolCallStatus } from '@agentx/shared';

export interface RepairResult {
  calls: NormalizedToolCall[];
  wasRepaired: boolean;
  repairReason?: string;
}

export class ToolCallRepairer {
  private readonly MAX_INPUT_LENGTH = 100_000;

  repair(
    rawText: string,
    knownToolNames: string[],
  ): RepairResult | null {
    // Protect against ReDoS by limiting input size
    if (rawText.length > this.MAX_INPUT_LENGTH) {
      return null;
    }

    const bracketResult = this.parseBracketFormat(rawText, knownToolNames);
    if (bracketResult) return bracketResult;

    const codeBlockResult = this.parseCodeBlockFormat(rawText, knownToolNames);
    if (codeBlockResult) return codeBlockResult;

    return null;
  }

  private parseBracketFormat(
    text: string,
    knownToolNames: string[],
  ): RepairResult | null {
    const pattern =
      /\[(\w+)\]\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*\[\/(\w+)\]/g;

    const calls: NormalizedToolCall[] = [];
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const rawName = match[1]!;
      const rawArgs = match[2]!;
      const closeName = match[3]!;

      if (rawName !== closeName) continue;

      const name = this.repairToolName(rawName, knownToolNames);

      try {
        const args = JSON.parse(rawArgs);
        calls.push({
          id: this.generateId(),
          name,
          arguments: args,
          status: ToolCallStatus.COMPLETED,
        });
      } catch {
        calls.push({
          id: this.generateId(),
          name,
          arguments: { _raw: rawArgs },
          status: ToolCallStatus.COMPLETED,
        });
      }
    }

    if (calls.length > 0) {
      return {
        calls,
        wasRepaired: true,
        repairReason: 'Parsed from bracket format [tool_name] { json } [/tool_name]',
      };
    }

    return null;
  }

  private parseCodeBlockFormat(
    text: string,
    knownToolNames: string[],
  ): RepairResult | null {
    const pattern = /```(?:tool_code|json)?\s*\n\s*(\w+)\s*\n([^`]*(?:`[^`]+`[^`]*)*)\s*```/g;

    const calls: NormalizedToolCall[] = [];
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const rawName = match[1]!.trim();
      const rawBody = match[2]!.trim();
      const name = this.repairToolName(rawName, knownToolNames);

      try {
        const bodyJson = JSON.parse(rawBody);
        if (bodyJson && typeof bodyJson === 'object') {
          calls.push({
            id: this.generateId(),
            name,
            arguments: bodyJson as Record<string, unknown>,
            status: ToolCallStatus.COMPLETED,
          });
        }
      } catch {
        // Not valid JSON in this block – try the next match
        continue;
      }
    }

    if (calls.length > 0) {
      return {
        calls,
        wasRepaired: true,
        repairReason: 'Parsed from code block format ```tool_code\\nname\\n{json}```',
      };
    }

    return null;
  }

  repairToolName(rawName: string, knownToolNames: string[]): string {
    const lowerRaw = rawName.toLowerCase();

    for (const known of knownToolNames) {
      if (known.toLowerCase() === lowerRaw) return known;
    }

    return rawName;
  }

  promoteTextToToolCalls(
    text: string,
    knownToolNames: string[],
  ): RepairResult | null {
    const lastBlock = text.split(/\n\n/).pop() ?? '';
    return this.parseBracketFormat(lastBlock, knownToolNames) ??
      this.parseCodeBlockFormat(lastBlock, knownToolNames);
  }

  private generateId(): string {
    return randomUUID();
  }
}
