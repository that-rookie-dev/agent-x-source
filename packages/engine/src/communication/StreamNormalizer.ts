import type { AgentXStreamEvent } from '@agentx/shared';

export class StreamNormalizer {
  private buffer = '';
  private readonly BUFFER_MAX_SIZE = 256 * 1024;
  private isInToolPattern = false;
  private toolCallCounter = 0;

  normalize(
    event: AgentXStreamEvent,
  ): AgentXStreamEvent | AgentXStreamEvent[] | null {
    switch (event.type) {
      case 'text.delta':
        return this.handleTextDelta(event);
      case 'tool.input.start':
      case 'tool.input.delta':
      case 'tool.input.end':
        return event;
      case 'turn.start':
      case 'turn.end':
        this.reset();
        return event;
      default:
        return event;
    }
  }

  private handleTextDelta(
    event: Extract<AgentXStreamEvent, { type: 'text.delta' }>,
  ): AgentXStreamEvent | AgentXStreamEvent[] | null {
    this.buffer += event.delta;

    if (this.buffer.length > this.BUFFER_MAX_SIZE) {
      this.buffer = this.buffer.slice(-this.BUFFER_MAX_SIZE / 2);
    }

    const toolPattern = this.detectToolPattern(this.buffer);

    if (toolPattern) {
      const { name, args, isComplete } = toolPattern;

      // Only emit events when the tool pattern is complete
      // Partial matches should be buffered until complete
      if (!isComplete) {
        // Mark that we're in a tool pattern to suppress regular text events
        this.isInToolPattern = true;
        return null;
      }

      // Complete pattern - emit the full event sequence
      this.isInToolPattern = true;

      const events: AgentXStreamEvent[] = [];

      this.toolCallCounter++;
      const toolId = `tc-stream-${this.toolCallCounter}`;

      events.push({
        type: 'tool.input.start',
        toolCallId: toolId,
        toolName: name,
        ts: Date.now(),
      });

      events.push({
        type: 'tool.input.delta',
        toolCallId: toolId,
        delta: args,
        ts: Date.now(),
      });

      events.push({
        type: 'tool.input.end',
        toolCallId: toolId,
        ts: Date.now(),
      });

      this.reset();

      return events;
    }

    if (this.isInToolPattern) {
      return null;
    }

    return event;
  }

  private detectToolPattern(
    text: string,
  ): { name: string; args: string; isComplete: boolean } | null {
    const bracketMatch = text.match(
      /\[(\w+)\]\s*(\{(?:[^{}]|\{[^{}]*\})*\})\s*\[\/\1\]/,
    );
    if (bracketMatch) {
      return {
        name: bracketMatch[1]!,
        args: bracketMatch[2]!,
        isComplete: true,
      };
    }

    const partialMatch = text.match(/\[(\w+)\]\s*(\{[^}]*)(?:[^}]*)$/);
    if (partialMatch && !text.includes(`[/${partialMatch[1]}]`)) {
      return {
        name: partialMatch[1]!,
        args: partialMatch[2]!,
        isComplete: false,
      };
    }

    return null;
  }

  private reset(): void {
    this.buffer = '';
    this.isInToolPattern = false;
  }
}
