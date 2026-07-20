/**
 * Node validation gate for the neural brain.
 *
 * Every extracted node must pass `isValidMemoryNode` before it is persisted to
 * `MemoryFabric.createNode()`. This is the single chokepoint that prevents
 * divider nodes, sentence fragments, heading-only nodes, and other mechanical
 * splitting artifacts from entering the graph.
 *
 * Scaffold categories (`source_doc`, episodic hubs) bypass semantic validation
 * because they are intentionally structural containers, not extracted concepts.
 *
 * See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §6 Stage 6 for the design spec.
 */
import { isDividerOnlyNode } from './sanitizeIngestText.js';

/** Categories that go through full semantic validation. */
export type ExtractedCategory = 'persona' | 'tool' | 'semantic' | 'system';

/** Categories that bypass validation (structural scaffold). */
export type ScaffoldCategory = 'source_doc' | 'episodic';

export type ValidatableCategory = ExtractedCategory | ScaffoldCategory;

export interface ValidatableNode {
  label: string;
  content: string;
  category: ValidatableCategory;
  /** Optional tag used to mark hub nodes that should bypass validation. */
  unitType?: string;
}

/** True when the node is a session/episode hub that should bypass validation. */
function isEpisodicHub(node: ValidatableNode): boolean {
  // Explicit tag from the creator (unitType='hub' for session hubs).
  if (node.unitType === 'hub') return true;
  // Heuristic: hubs created during document ingest use these patterns.
  if (/^Session hub/i.test(node.label)) return true;
  if (/^#\s*Session/i.test(node.content)) return true;
  return false;
}

/** True when `content` looks like a mid-thought fragment rather than a complete claim. */
export function isSentenceFragment(content: string): boolean {
  const t = content.trim();
  if (t.length < 3) return true;
  // Ends on a coordinating/subordinating conjunction → mid-thought.
  if (/\b(and|or|but|because|since|while|when|if|that|which|where|who)\s*$/i.test(t)) return true;
  // Otherwise: accept. This detector is intentionally conservative (errs toward
  // accepting real propositions). Verbless noun phrases like "Mass extinction
  // ending dinosaurs" are valid concept descriptions, not fragments. The
  // min-words check in isValidMemoryNode catches truly empty content, and
  // isDividerOnlyNode / isHeadingOnlyNode catch structural junk.
  return false;
}

/** True when the node is just a markdown heading with no real content beneath it. */
export function isHeadingOnlyNode(label: string, content: string): boolean {
  const headingMatch = label.match(/^#{1,6}\s+(.+)$/);
  if (!headingMatch || !headingMatch[1]) return false;
  const headingText = headingMatch[1].trim();
  const contentTrim = content.trim();
  return contentTrim === headingText || contentTrim === label.trim();
}

/**
 * Shannon entropy in bits/char. A 2.5 bits/char minimum gate filters
 * low-information labels (e.g. "ts.", "aaa", "111").
 */
export function shannonEntropy(text: string): number {
  if (!text) return 0;
  const freq = new Map<string, number>();
  for (const ch of text) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  const len = text.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Minimum entropy for a label to be considered informative. */
const MIN_LABEL_ENTROPY = 2.5;

/**
 * True when the label looks like a raw text fragment rather than a named
 * concept. Detects: starts with lowercase, contains markdown syntax, starts
 * with a sentence fragment tail, or has line breaks (labels should be short).
 */
function isFragmentLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return true;

  // Labels with line breaks are raw text fragments, not concept names.
  if (t.includes('\n')) return true;

  // Labels starting with lowercase + punctuation are fragment tails
  // (e.g. "ts." from "teams.", "Example:" from a bullet list).
  if (/^[a-z][a-z]*\./.test(t) && t.length < 10) return true;

  // Labels containing markdown table/list syntax are raw text slices.
  if (/^\|/.test(t)) return true;
  if (/^- /.test(t)) return true;
  if (/^\d+\.\s/.test(t)) return true;

  // Labels that are just punctuation/symbols.
  if (!/[a-zA-Z]/.test(t)) return true;

  return false;
}

/**
 * Validate a single node. Returns true if the node may be persisted.
 *
 * Scaffold categories (`source_doc`, episodic hubs) bypass semantic checks.
 * Extracted categories must pass: not divider-only, label ≥ 3 chars with alnum,
 * content ≥ 3 words, not a sentence fragment, not heading-only.
 */
export function isValidMemoryNode(node: ValidatableNode): boolean {
  // Scaffold bypass.
  if (node.category === 'source_doc') return true;
  if (node.category === 'episodic' && isEpisodicHub(node)) return true;

  // Structural junk — reject regardless of category.
  if (isDividerOnlyNode(node.label, node.content)) return false;

  // Label checks.
  if (node.label.trim().length < 3) return false;
  if (!/[a-zA-Z0-9]/.test(node.label)) return false; // not pure punctuation/symbols
  if (isHeadingOnlyNode(node.label, node.content)) return false;
  // Entropy gate — reject low-information labels. Applied to raw_fallback and
  // episodic nodes only (short concept names like "Real" naturally have low
  // entropy but are valid). The entropy gate catches garbage fragment labels,
  // not short named entities.
  if ((node.unitType === 'raw_fallback' || node.category === 'episodic') && shannonEntropy(node.label) < MIN_LABEL_ENTROPY) return false;
  // Fragment label check — reject raw text fragments posing as labels.
  if (isFragmentLabel(node.label)) return false;

  // Content checks (relaxed for raw_fallback episodic nodes — they are intentionally
  // raw text, but still must have minimum information density).
  const minWords = node.unitType === 'raw_fallback' ? 2 : 3;
  if (node.content.split(/\s+/).filter(Boolean).length < minWords) return false;

  // Fragment check — skipped for raw_fallback (it is a raw unit by design).
  if (node.unitType !== 'raw_fallback' && isSentenceFragment(node.content)) return false;

  return true;
}

/**
 * Filter a batch of nodes + edges, dropping invalid nodes and any edges that
 * referenced them. This is the helper called at each extraction→persistence
 * boundary in `MemoryService.ingest` and `DocumentIngestPipeline.process`.
 */
export function validateAndFilter<
  T extends ValidatableNode & { id?: string },
  E extends { sourceNodeId: string; targetNodeId: string },
>(nodes: T[], edges: E[]): { nodes: T[]; edges: E[] } {
  const kept = nodes.filter((n) => isValidMemoryNode(n));
  const keptIds = new Set(kept.map((n) => n.id).filter(Boolean) as string[]);
  const filteredEdges = edges.filter(
    (e) => keptIds.has(e.sourceNodeId) && keptIds.has(e.targetNodeId),
  );
  return { nodes: kept, edges: filteredEdges };
}
