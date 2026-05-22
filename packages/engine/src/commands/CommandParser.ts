import type { InputType } from '@agentx/shared';

export interface ParsedInput {
  type: InputType;
  raw: string;
  command?: string;
  args?: string[];
}

export class CommandParser {
  parse(input: string): ParsedInput {
    const trimmed = input.trim();

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/);
      const command = parts[0] ?? '';
      const args = parts.slice(1);
      return {
        type: 'command',
        raw: trimmed,
        command,
        args,
      };
    }

    return {
      type: 'conversation',
      raw: trimmed,
    };
  }

  isCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  extractPrefix(input: string): string {
    if (!this.isCommand(input)) return '';
    const parts = input.trim().slice(1).split(/\s+/);
    return parts[0] ?? '';
  }
}
