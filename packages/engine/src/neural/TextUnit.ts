/**
 * TextUnit — the intermediate analysis window between source text and the
 * knowledge graph.
 *
 * TextUnits are NOT persisted as neurons. They are ephemeral containers that
 * the KnowledgeExtractor (Stage 4) operates on. Each TextUnit carries full
 * provenance (document/session, heading path, character span) so that nodes
 * extracted from it can be traced back to the exact source location.
 *
 * This is the TextUnit concept — the bridge between source documents and the
 * extracted knowledge graph.
 * See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §6 Stage 3.
 */

export type TextUnitType =
  | 'proposition'    // atomic factual claim (chat turns)
  | 'paragraph'      // plain-text paragraph
  | 'section'        // markdown section under a heading
  | 'list_item'      // a single list entry
  | 'code_block'     // fenced code block
  | 'raw_fallback';  // failed-extraction fallback (persisted as a single node)

export interface TextUnitSource {
  documentId?: string;
  sessionId?: string;
  turnIndex?: number;
  headingPath?: string[];   // e.g. ["## Auth", "### JWT"]
  charStart: number;
  charEnd: number;
}

export interface TextUnit {
  /** Deterministic id: hash of (parentUnitId | documentId | sessionId) + charStart + charEnd). */
  id: string;
  text: string;
  /** Approximate token count (word count × 1.3). */
  tokenCount: number;
  type: TextUnitType;
  source: TextUnitSource;
  parentUnitId?: string;
}

/** Approximate token count for a text string (word count × 1.3). */
export function approxTokenCount(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

/**
 * Deterministic TextUnit id. Same source span → same id → safe to dedupe on
 * re-ingestion. Uses a simple FNV-1a hash rendered as a hex string (no external
 * dependency). This is NOT a UUID — it is a stable content-addressed key.
 */
export function textUnitId(
  parent: string | undefined,
  source: TextUnitSource,
): string {
  const ns = parent ?? source.documentId ?? source.sessionId ?? 'orphan';
  const key = `${ns}|${source.charStart}|${source.charEnd}`;
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `tu_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Construct a TextUnit with computed id and token count. */
export function makeTextUnit(
  text: string,
  type: TextUnitType,
  source: TextUnitSource,
  parentUnitId?: string,
): TextUnit {
  return {
    id: textUnitId(parentUnitId, source),
    text,
    tokenCount: approxTokenCount(text),
    type,
    source,
    parentUnitId,
  };
}
