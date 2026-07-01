/**
 * FastOfflineExtractor — heuristic offline extraction (last-resort fallback).
 *
 * For simple chat turns (short, no complex structure), we skip the LLM call
 * entirely and use heuristic NER + relation extraction. This saves LLM costs
 * for the majority of chat turns that don't need deep knowledge extraction.
 *
 * The heuristic approach:
 * 1. Detect if the text is "simple" (short, few sentences, no markdown)
 * 2. Extract entities via capitalized-word NER, number detection, date detection
 * 3. Extract relations via simple pattern matching (subject-verb-object)
 * 4. If the text is too complex, return null → caller falls back to LLM
 *
 * This is a fast pre-filter that handles simple text when no LLM is configured.
 * It is NOT used as a primary extraction method — the LLM is always preferred.
 *
 * See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §6 Stage 4 (fast offline path).
 */
import type { MemoryNodeInput, MemoryEdgeInput } from './MemoryFabric.js';
import { segmentText } from './SemanticSegmenter.js';
import type { TextUnit } from './TextUnit.js';

export interface FastOfflineOptions {
  /** Maximum text length (chars) for the fast path. Default: 500. */
  maxLength?: number;
  /** Maximum sentences for the fast path. Default: 5. */
  maxSentences?: number;
  /** Session id for provenance. */
  sessionId?: string;
  /** Agent id for provenance. */
  agentId?: string;
  /** Source id for provenance. */
  sourceId?: string;
}

export interface FastOfflineResult {
  nodes: MemoryNodeInput[];
  edges: MemoryEdgeInput[];
  /** True if the fast path was used; false if the text is too complex (caller should use LLM). */
  usedFastPath: boolean;
}

/**
 * Attempt fast offline extraction. Returns `usedFastPath: false` if the text
 * is too complex for heuristics — the caller should fall back to the LLM.
 */
export function fastOfflineExtract(
  text: string,
  options: FastOfflineOptions = {},
): FastOfflineResult {
  const maxLength = options.maxLength ?? 500;
  const maxSentences = options.maxSentences ?? 5;

  // Check if the text is simple enough for the fast path.
  if (!shouldUseFastPath(text, maxLength, maxSentences)) {
    return { nodes: [], edges: [], usedFastPath: false };
  }

  const nodes: MemoryNodeInput[] = [];
  const edges: MemoryEdgeInput[] = [];

  // Segment into TextUnits (propositions for chat).
  const units = segmentText(text, { sessionId: options.sessionId });

  for (const unit of units) {
    const unitNodes = extractEntitiesFromUnit(unit, options);
    if (unitNodes.length > 0) {
      nodes.push(...unitNodes);
      // Link nodes from the same unit with RELATED_TO edges.
      for (let i = 0; i < unitNodes.length - 1; i++) {
        const src = unitNodes[i]!;
        const tgt = unitNodes[i + 1]!;
        if (src.id && tgt.id) {
          edges.push({
            sourceNodeId: src.id,
            targetNodeId: tgt.id,
            relationshipType: 'RELATED_TO',
            weight: 0.4,
            extractionMethod: 'INFERRED',
          });
        }
      }
    }
  }

  // If the fast path extracted zero entities, return usedFastPath: false so
  // the caller falls back to the LLM. Creating a raw_fallback node for every
  // simple-looking text that has no proper nouns/numbers/dates produces
  // garbage nodes (e.g. "user: I need a diet plan" → raw_fallback).
  if (nodes.length === 0) {
    return { nodes: [], edges: [], usedFastPath: false };
  }

  return { nodes, edges, usedFastPath: true };
}

/**
 * Determine if the text is simple enough for the fast offline path.
 * Complex text (markdown, code, long, many sentences) needs the LLM.
 */
function shouldUseFastPath(text: string, maxLength: number, maxSentences: number): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > maxLength) return false;

  // Markdown structure → needs LLM.
  if (/^#{1,6}\s/m.test(trimmed)) return false;
  if (/```/.test(trimmed)) return false;
  if (/^\|.*\|/m.test(trimmed)) return false;

  // Count sentences.
  const sentences = trimmed.match(/[.!?]+/g);
  if (sentences && sentences.length > maxSentences) return false;

  // Technical complexity heuristics.
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 100) return false;

  // Too many capitalized words → likely proper nouns needing LLM disambiguation.
  const capitalized = words.filter((w) => /^[A-Z][a-z]+/.test(w));
  if (capitalized.length > 10) return false;

  return true;
}

/**
 * Extract entities from a single TextUnit using heuristics.
 * Detects: capitalized nouns, numbers, dates, URLs, code identifiers.
 */
function extractEntitiesFromUnit(
  unit: TextUnit,
  options: FastOfflineOptions,
): MemoryNodeInput[] {
  const text = unit.text;
  const nodes: MemoryNodeInput[] = [];
  const seen = new Set<string>();

  const addNode = (label: string, content: string, category: MemoryNodeInput['category']) => {
    const normalized = label.toLowerCase().trim();
    if (seen.has(normalized)) return;
    if (label.length < 2 || label.length > 120) return;
    seen.add(normalized);
    nodes.push({
      id: crypto.randomUUID(),
      label,
      category,
      content,
      confidence: 0.6,
      sessionId: options.sessionId,
      agentId: options.agentId,
      sourceId: options.sourceId,
      headingPath: unit.source.headingPath,
      charSpan: [unit.source.charStart, unit.source.charEnd],
      unitType: unit.type,
    });
  };

  // 1. Capitalized word sequences (proper nouns / names).
  const properNounMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g);
  if (properNounMatches) {
    for (const match of properNounMatches) {
      // Skip sentence-initial capitalization (common nouns at start of sentence).
      const idx = text.indexOf(match);
      if (idx === 0 || text[idx - 1] === '.' || text[idx - 1] === '!' || text[idx - 1] === '?') {
        // Only skip if it's a single word — multi-word capitalized sequences are likely proper nouns.
        if (!match.includes(' ')) continue;
      }
      addNode(match, `${match} mentioned in the conversation.`, 'semantic');
    }
  }

  // 2. Numbers and quantities.
  const numberMatches = text.match(/\b\d+(?:\.\d+)?(?:\s*%)?\b/g);
  if (numberMatches) {
    for (const match of numberMatches) {
      addNode(`Value: ${match}`, `The number ${match} appears in the conversation.`, 'semantic');
    }
  }

  // 3. Dates.
  const dateMatches = text.match(/\b\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?/gi);
  if (dateMatches) {
    for (const match of dateMatches) {
      addNode(`Date: ${match}`, `The date ${match} is referenced.`, 'semantic');
    }
  }

  // 4. URLs.
  const urlMatches = text.match(/https?:\/\/[^\s]+/g);
  if (urlMatches) {
    for (const match of urlMatches) {
      addNode(`URL: ${match.slice(0, 80)}`, `Link to ${match}`, 'tool');
    }
  }

  // 5. Code identifiers (camelCase / snake_case).
  const codeMatches = text.match(/\b[a-z][a-zA-Z]*[A-Z][a-zA-Z]*\b|\b[a-z]+_[a-z_]+\b/g);
  if (codeMatches) {
    for (const match of codeMatches) {
      if (match.length > 3) {
        addNode(match, `The identifier ${match} is mentioned.`, 'tool');
      }
    }
  }

  return nodes;
}
