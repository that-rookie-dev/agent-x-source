/**
 * ResponseFormatter processes raw LLM output into structured formatted responses.
 * Handles markdown parsing, code block detection, and output segmentation.
 */
export interface FormattedSegment {
  type: 'text' | 'code' | 'thinking' | 'tool_use' | 'heading' | 'list';
  content: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export class ResponseFormatter {
  private buffer = '';
  private segments: FormattedSegment[] = [];
  private inCodeBlock = false;
  private codeLanguage = '';
  private codeBuffer = '';

  /**
   * Process a streaming chunk and return any completed segments.
   */
  processChunk(chunk: string): FormattedSegment[] {
    this.buffer += chunk;
    const completed: FormattedSegment[] = [];

    // Process line by line when we have newlines
    while (this.buffer.includes('\n')) {
      const idx = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);

      const segment = this.processLine(line);
      if (segment) completed.push(segment);
    }

    return completed;
  }

  /**
   * Flush remaining buffer content as a final segment.
   */
  flush(): FormattedSegment[] {
    const completed: FormattedSegment[] = [];

    if (this.inCodeBlock && this.codeBuffer) {
      completed.push({ type: 'code', content: this.codeBuffer, language: this.codeLanguage });
      this.inCodeBlock = false;
      this.codeBuffer = '';
    }

    if (this.buffer.trim()) {
      completed.push({ type: 'text', content: this.buffer.trim() });
      this.buffer = '';
    }

    return completed;
  }

  /**
   * Format a complete response string into segments.
   */
  static format(text: string): FormattedSegment[] {
    const formatter = new ResponseFormatter();
    const segments = formatter.processChunk(text + '\n');
    segments.push(...formatter.flush());
    return segments;
  }

  private processLine(line: string): FormattedSegment | null {
    // Code block boundaries
    if (line.startsWith('```')) {
      if (this.inCodeBlock) {
        const segment: FormattedSegment = {
          type: 'code',
          content: this.codeBuffer,
          language: this.codeLanguage,
        };
        this.codeBuffer = '';
        this.codeLanguage = '';
        this.inCodeBlock = false;
        return segment;
      } else {
        this.inCodeBlock = true;
        this.codeLanguage = line.slice(3).trim();
        this.codeBuffer = '';
        return null;
      }
    }

    // Inside code block
    if (this.inCodeBlock) {
      this.codeBuffer += (this.codeBuffer ? '\n' : '') + line;
      return null;
    }

    // Headings
    if (line.startsWith('# ') || line.startsWith('## ') || line.startsWith('### ')) {
      return { type: 'heading', content: line.replace(/^#+\s*/, '') };
    }

    // List items
    if (line.match(/^\s*[-*•]\s/) || line.match(/^\s*\d+\.\s/)) {
      return { type: 'list', content: line };
    }

    // Empty lines — skip
    if (!line.trim()) return null;

    // Regular text
    return { type: 'text', content: line };
  }

  /**
   * Get all processed segments.
   */
  getSegments(): FormattedSegment[] {
    return [...this.segments];
  }

  /**
   * Reset the formatter state.
   */
  reset(): void {
    this.buffer = '';
    this.segments = [];
    this.inCodeBlock = false;
    this.codeBuffer = '';
    this.codeLanguage = '';
  }
}
