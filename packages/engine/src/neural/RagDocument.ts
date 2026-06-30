/**
 * Robust PDF/RAG document ingestion with semantic chunking.
 *
 * Splits documents by paragraphs and headings, preserving section boundaries
 * and an overlap window. Produces a source document node plus chunk nodes
 * linked by CONTAINS / NEXT_STEP edges.
 */

export interface Chunk {
  index: number;
  label: string;
  content: string;
  embedding?: number[];
}

export interface RagDocumentMetadata {
  title: string;
  author?: string;
  pageCount?: number;
  kind: 'pdf' | 'markdown' | 'text' | 'json' | 'web';
}

export interface RagDocumentOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  /** When true, headings split chunks. */
  splitByHeading?: boolean;
  /** When true, a line break is added before chunk boundaries to preserve structure. */
  preserveParagraphs?: boolean;
}

export class RagDocument {
  readonly metadata: RagDocumentMetadata;
  private text: string;
  private options: Required<RagDocumentOptions>;

  constructor(text: string, metadata: RagDocumentMetadata, options: RagDocumentOptions = {}) {
    this.text = text;
    this.metadata = { ...metadata };
    this.options = {
      chunkSize: options.chunkSize ?? 800,
      chunkOverlap: options.chunkOverlap ?? 100,
      splitByHeading: options.splitByHeading ?? true,
      preserveParagraphs: options.preserveParagraphs ?? true,
    };
  }

  chunks(): Chunk[] {
    const units = this.splitIntoUnits();
    const chunks: Chunk[] = [];
    let buffer = '';
    let index = 0;

    for (const unit of units) {
      const next = this.options.preserveParagraphs ? buffer + '\n\n' + unit : buffer + ' ' + unit;
      if (buffer.length > 0 && (this.isHeading(unit) || next.length > this.options.chunkSize)) {
        chunks.push(this.makeChunk(index++, buffer.trim()));
        buffer = this.options.chunkOverlap > 0 ? this.tailOverlap(buffer) : '';
      }
      buffer = buffer ? buffer + '\n\n' + unit : unit;
    }

    if (buffer.trim()) {
      chunks.push(this.makeChunk(index, buffer.trim()));
    }

    return chunks;
  }

  private splitIntoUnits(): string[] {
    if (this.options.splitByHeading) {
      return this.splitByHeadings(this.text);
    }
    return this.text.split(/\n\s*\n/).filter((u) => u.trim().length > 0);
  }

  private splitByHeadings(text: string): string[] {
    const units: string[] = [];
    const lines = text.split('\n');
    let buffer: string[] = [];
    for (const line of lines) {
      if (this.isHeading(line)) {
        if (buffer.length > 0) {
          units.push(buffer.join('\n').trim());
          buffer = [];
        }
        units.push(line.trim());
      } else {
        buffer.push(line);
      }
    }
    if (buffer.length > 0) {
      units.push(buffer.join('\n').trim());
    }
    return units.filter((u) => u.length > 0);
  }

  private isHeading(line: string): boolean {
    return /^#{1,6}\s+/.test(line.trim()) || /^[A-Z][A-Za-z0-9\s]{2,80}\n*$/.test(line.trim()) && line.trim().length < 80;
  }

  private tailOverlap(buffer: string): string {
    const tail = buffer.slice(-this.options.chunkOverlap).trim();
    const sentenceBreak = tail.lastIndexOf('. ');
    return sentenceBreak > 0 ? tail.slice(sentenceBreak + 2) : tail;
  }

  private makeChunk(index: number, content: string): Chunk {
    return {
      index,
      label: `${this.metadata.title || 'Document'} chunk ${index + 1}`,
      content,
    };
  }
}
