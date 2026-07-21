/**
 * Robust PDF/RAG document ingestion with semantic chunking.
 *
 * Splits documents by paragraphs and headings, preserving section boundaries
 * and an overlap window. Produces chunks with contextualized embedText
 * (Title › Section › body). Order edges are created at ingest time as FOLLOWS.
 */

import {
  buildEmbedText,
  pushHeadingPath,
  headingLevel,
  RETRIEVAL_DEFAULTS,
} from './retrieval/index.js';

export interface Chunk {
  index: number;
  label: string;
  /** Display / stored body (section text). */
  content: string;
  /** Text embedded at ingest — includes title + heading path. */
  embedText: string;
  headingPath: string[];
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
  chunkMinChars?: number;
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
      chunkSize: options.chunkSize ?? RETRIEVAL_DEFAULTS.chunkTargetChars,
      chunkOverlap: options.chunkOverlap ?? RETRIEVAL_DEFAULTS.chunkOverlapChars,
      chunkMinChars: options.chunkMinChars ?? RETRIEVAL_DEFAULTS.chunkMinChars,
      splitByHeading: options.splitByHeading ?? true,
      preserveParagraphs: options.preserveParagraphs ?? true,
    };
  }

  chunks(): Chunk[] {
    const units = this.splitIntoUnits();
    const chunks: Chunk[] = [];
    let buffer = '';
    let bufferPath: string[] = [];
    let headingPath: string[] = [];
    let index = 0;

    const flush = (force = false) => {
      const trimmed = buffer.trim();
      if (!trimmed) {
        buffer = '';
        return;
      }
      if (!force && trimmed.length < this.options.chunkMinChars) {
        return;
      }
      if (trimmed.length > this.options.chunkSize) {
        for (const piece of this.forceSplit(trimmed, this.options.chunkSize, this.options.chunkOverlap)) {
          chunks.push(this.makeChunk(index++, piece.trim(), bufferPath));
        }
      } else {
        chunks.push(this.makeChunk(index++, trimmed, bufferPath));
      }
      buffer = this.options.chunkOverlap > 0 ? this.tailOverlap(trimmed) : '';
      // Keep path for overlap continuation under same section.
    };

    for (const unit of units) {
      const level = headingLevel(unit);
      if (level != null) {
        // Always close the previous section on a heading boundary (even if short).
        if (buffer.trim()) flush(true);
        headingPath = pushHeadingPath(headingPath, unit);
        bufferPath = [...headingPath];
        // Headings alone are not chunks; attach to following body.
        continue;
      }

      const next = this.options.preserveParagraphs
        ? (buffer ? `${buffer}\n\n${unit}` : unit)
        : (buffer ? `${buffer} ${unit}` : unit);

      if (buffer.length > 0 && next.length > this.options.chunkSize) {
        flush(true);
        bufferPath = [...headingPath];
      }

      buffer = buffer
        ? (this.options.preserveParagraphs ? `${buffer}\n\n${unit}` : `${buffer} ${unit}`)
        : unit;
      if (!bufferPath.length) bufferPath = [...headingPath];
    }

    if (buffer.trim()) {
      flush(true);
    }

    // Merge trailing tiny chunk into previous when possible.
    if (chunks.length >= 2) {
      const last = chunks[chunks.length - 1]!;
      const prev = chunks[chunks.length - 2]!;
      if (
        last.content.length < this.options.chunkMinChars
        && prev.content.length + last.content.length <= this.options.chunkSize
        && samePath(prev.headingPath, last.headingPath)
      ) {
        const mergedContent = `${prev.content}\n\n${last.content}`.trim();
        chunks[chunks.length - 2] = this.makeChunk(prev.index, mergedContent, prev.headingPath);
        chunks.pop();
      }
    }

    // Re-index after merges.
    return chunks.map((c, i) => ({ ...c, index: i, label: `${this.metadata.title || 'Document'} chunk ${i + 1}` }));
  }

  private forceSplit(text: string, chunkSize: number, overlap: number): string[] {
    const pieces: string[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text];
    let buf = '';
    for (const sentence of sentences) {
      const next = buf + sentence;
      if (buf.length > 0 && next.length > chunkSize) {
        pieces.push(buf.trim());
        buf = overlap > 0 ? buf.slice(-overlap).trim() : '';
      }
      if (sentence.length > chunkSize) {
        if (buf.trim()) { pieces.push(buf.trim()); buf = ''; }
        for (let i = 0; i < sentence.length; i += chunkSize - overlap) {
          pieces.push(sentence.slice(i, i + chunkSize).trim());
        }
        continue;
      }
      buf = buf + sentence;
    }
    if (buf.trim()) pieces.push(buf.trim());
    return pieces.length > 0 ? pieces : [text.slice(0, chunkSize)];
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
      if (headingLevel(line) != null) {
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

  private tailOverlap(buffer: string): string {
    const tail = buffer.slice(-this.options.chunkOverlap).trim();
    const sentenceBreak = tail.lastIndexOf('. ');
    return sentenceBreak > 0 ? tail.slice(sentenceBreak + 2) : tail;
  }

  private makeChunk(index: number, content: string, headingPath: string[]): Chunk {
    const title = this.metadata.title || 'Document';
    const path = headingPath.length ? headingPath : [];
    return {
      index,
      label: `${title} chunk ${index + 1}`,
      content,
      embedText: buildEmbedText({ title, headingPath: path, body: content }),
      headingPath: [...path],
    };
  }
}

function samePath(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
