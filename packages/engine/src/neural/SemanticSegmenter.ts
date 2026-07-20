/**
 * SemanticSegmenter — segments text into TextUnits for memory extraction.
 *
 * Type-aware segmentation: picks the right segmenter based on content type and
 * produces TextUnits (analysis windows) with full provenance. TextUnits are NOT
 * nodes — they are the input to the KnowledgeExtractor (Stage 4).
 *
 * Three segmenters:
 * - PropositionSegmenter: chat turns (1-3 sentences) → 1-3 proposition TextUnits
 * - MarkdownSegmenter: markdown docs → section TextUnits (wraps RagDocument)
 * - ParagraphSegmenter: plain text → paragraph TextUnits
 *
 * See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §6 Stage 2.
 */
import { RagDocument } from './RagDocument.js';
import { makeTextUnit, type TextUnit, type TextUnitSource } from './TextUnit.js';
import { sanitizeIngestText } from './sanitizeIngestText.js';

export type ContentType = 'chat_turn' | 'markdown_doc' | 'plain_text' | 'code_block' | 'list' | 'table';

/** Detect the content type of a text blob to pick the right segmenter. */
export function detectContentType(text: string): ContentType {
  // Chat turn detection takes priority — combined user+assistant text starts
  // with "user:" or "assistant:". Even if the assistant response contains
  // markdown headings, the overall text is a chat exchange, not a document.
  if (/^(user|assistant|system):\s/im.test(text)) return 'chat_turn';
  if (/^\s*```/.test(text) && text.split('```').length >= 3) return 'code_block';
  if (/^\s*\|.*\|[\s\S]*\n\s*\|[-:\s|]+\|/.test(text)) return 'table';
  if (/^#{1,6}\s/m.test(text) || /^\*\*.+\*\*\s*$/m.test(text)) return 'markdown_doc';
  const listMatches = text.match(/^\s*[-*•]\s/gm);
  if (listMatches && listMatches.length >= 3) return 'list';
  if (text.length < 500) return 'chat_turn';
  return 'plain_text';
}

export interface SegmentOptions {
  /** Session or document id for provenance. */
  parentId?: string;
  /** Session id (for chat). */
  sessionId?: string;
  /** Document id (for docs). */
  documentId?: string;
  /** Turn index (for chat). */
  turnIndex?: number;
  /** Chunk size for long documents (tokens). */
  chunkSize?: number;
  /** Chunk overlap for long documents (tokens). */
  chunkOverlap?: number;
}

/**
 * Main entry point: segment text into TextUnits based on detected content type.
 */
export function segmentText(text: string, options: SegmentOptions = {}): TextUnit[] {
  const cleaned = sanitizeIngestText(text);
  if (!cleaned.trim()) return [];

  const contentType = detectContentType(cleaned);

  switch (contentType) {
    case 'chat_turn':
      return segmentChatTurn(cleaned, options);
    case 'markdown_doc':
    case 'list':
    case 'table':
      return segmentMarkdownDoc(cleaned, options);
    case 'code_block':
      return segmentCodeBlock(cleaned, options);
    case 'plain_text':
    default:
      return segmentPlainText(cleaned, options);
  }
}

// ─── Chat turn segmenter ───────────────────────────────────────────────────

/**
 * Segment a chat turn into proposition TextUnits.
 * Strips role prefixes (user:/assistant:/system:), then splits on sentence
 * boundaries. Each sentence (or group of closely related sentences) becomes
 * a proposition TextUnit.
 */
function segmentChatTurn(text: string, options: SegmentOptions): TextUnit[] {
  // Strip ALL role prefixes (user:, assistant:, system:) — the combined text
  // may contain multiple turns (e.g. "user: ...\n\nassistant: ...").
  const stripped = text.replace(/^(user|assistant|system):\s*/gim, '');

  // Protect URLs from sentence splitting (periods in URLs are not sentence boundaries).
  const urlPlaceholders: string[] = [];
  const protectedText = stripped.replace(/https?:\/\/[^\s]+/g, (url) => {
    const placeholder = `__URL_${urlPlaceholders.length}__`;
    urlPlaceholders.push(url);
    return placeholder;
  });

  // Split into sentences, keeping punctuation.
  const sentences = protectedText.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [protectedText];
  const trimmed = sentences
    .map((s) => s.trim())
    .map((s) => s.replace(/__URL_(\d+)__/g, (_, i) => urlPlaceholders[Number(i)] ?? ''))
    .filter((s) => s.length > 0);

  const units: TextUnit[] = [];
  let offset = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const sentence = trimmed[i]!;
    const charStart = stripped.indexOf(sentence, offset);
    const charEnd = charStart + sentence.length;
    offset = charEnd;

    const source: TextUnitSource = {
      sessionId: options.sessionId,
      turnIndex: options.turnIndex,
      charStart,
      charEnd,
    };
    units.push(makeTextUnit(sentence, 'proposition', source, options.parentId));
  }

  // If no sentences were found (e.g. single word), create one unit for the whole text.
  if (units.length === 0 && stripped.trim()) {
    const source: TextUnitSource = {
      sessionId: options.sessionId,
      turnIndex: options.turnIndex,
      charStart: 0,
      charEnd: stripped.length,
    };
    units.push(makeTextUnit(stripped.trim(), 'proposition', source, options.parentId));
  }

  return units;
}

// ─── Markdown document segmenter ───────────────────────────────────────────

/**
 * Segment a markdown document into section TextUnits using RagDocument's
 * heading-aware chunking. Each chunk becomes a section TextUnit with the
 * heading path recorded in provenance.
 */
function segmentMarkdownDoc(text: string, options: SegmentOptions): TextUnit[] {
  const doc = new RagDocument(text, {
    title: options.documentId ?? 'document',
    kind: 'markdown',
  }, {
    chunkSize: options.chunkSize ?? 800,
    chunkOverlap: options.chunkOverlap ?? 100,
    splitByHeading: true,
    preserveParagraphs: true,
  });

  const chunks = doc.chunks();
  const units: TextUnit[] = [];
  let charOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    // Find the chunk's position in the original text.
    const charStart = text.indexOf(chunk.content, charOffset);
    const effectiveStart = charStart >= 0 ? charStart : charOffset;
    const charEnd = effectiveStart + chunk.content.length;
    charOffset = charEnd;

    // Extract heading path from the chunk label/content.
    const headingPath = extractHeadingPath(chunk.content);

    const source: TextUnitSource = {
      documentId: options.documentId,
      sessionId: options.sessionId,
      headingPath: headingPath.length > 0 ? headingPath : undefined,
      charStart: effectiveStart,
      charEnd,
    };
    units.push(makeTextUnit(chunk.content, 'section', source, options.parentId));
  }

  return units;
}

/** Extract a heading path (e.g. ["## Auth", "### JWT"]) from a chunk's content. */
function extractHeadingPath(content: string): string[] {
  const headings: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6}\s+.+)$/);
    if (match && match[1]) headings.push(match[1].trim());
  }
  return headings;
}

// ─── Code block segmenter ──────────────────────────────────────────────────

function segmentCodeBlock(text: string, options: SegmentOptions): TextUnit[] {
  const source: TextUnitSource = {
    documentId: options.documentId,
    sessionId: options.sessionId,
    charStart: 0,
    charEnd: text.length,
  };
  return [makeTextUnit(text, 'code_block', source, options.parentId)];
}

// ─── Plain text segmenter ──────────────────────────────────────────────────

/**
 * Segment plain text into paragraph TextUnits. Splits on double-newlines,
 * merges very short paragraphs (< 20 chars) with the next one.
 */
function segmentPlainText(text: string, options: SegmentOptions): TextUnit[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const units: TextUnit[] = [];
  let offset = 0;
  let buffer = '';
  let bufferStart = 0;

  const flushBuffer = () => {
    if (buffer.trim()) {
      const source: TextUnitSource = {
        documentId: options.documentId,
        sessionId: options.sessionId,
        charStart: bufferStart,
        charEnd: bufferStart + buffer.length,
      };
      units.push(makeTextUnit(buffer.trim(), 'paragraph', source, options.parentId));
    }
    buffer = '';
  };

  for (const para of paragraphs) {
    const charStart = text.indexOf(para, offset);
    const effectiveStart = charStart >= 0 ? charStart : offset;
    offset = effectiveStart + para.length;

    if (para.length < 20 && !buffer) {
      buffer = para;
      bufferStart = effectiveStart;
    } else if (para.length < 20 && buffer) {
      buffer += '\n\n' + para;
    } else {
      if (buffer) {
        buffer += '\n\n' + para;
        flushBuffer();
      } else {
        const source: TextUnitSource = {
          documentId: options.documentId,
          sessionId: options.sessionId,
          charStart: effectiveStart,
          charEnd: effectiveStart + para.length,
        };
        units.push(makeTextUnit(para, 'paragraph', source, options.parentId));
      }
    }
  }
  flushBuffer();

  return units;
}
