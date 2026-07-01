/**
 * Knowledge graph extraction protocol.
 *
 * Turns arbitrary text (chat messages, documents, tool outputs) into a rich
 * knowledge graph of atomic entities, concepts, facts, and typed relationships
 * suitable for the unified MemoryFabric.
 *
 * Implements:
 * - Semantic text chunking into analyzable TextUnits
 * - Entity / fact / concept extraction per chunk
 * - Relationship extraction between extracted entities (subject-relationship-object)
 * - Deduplication of entities by normalized label within an extraction run
 * - Zod schema validation for the LLM output
 * - Up to 2 self-healing retries with a stricter JSON-schema prompt
 * - Optional GBNF grammar hint (passed to the generator for backends that support it)
 * - A built-in local LLM generator factory via LocalLLMJudge
 */
import { z } from 'zod';
import type { MemoryNodeInput, MemoryEdgeInput, MemoryEdgeType } from './MemoryFabric.js';
import { LocalLLMJudge } from './LocalLLMJudge.js';
import { filterDividerNodes, sanitizeIngestText } from './sanitizeIngestText.js';
import { segmentText } from './SemanticSegmenter.js';
import type { TextUnit } from './TextUnit.js';
import { getLogger } from '@agentx/shared';
import { countInputTokens, estimateOutputTokens } from '../session/tokenCount.js';

export interface ExtractedMemory {
  nodes: MemoryNodeInput[];
  edges: MemoryEdgeInput[];
  /** Number of LLM calls made during extraction (0 for heuristic/fast path). */
  llmCallCount?: number;
}

/** Sub-stage progress event fired from within the extractor. */
export interface ExtractProgressEvent {
  /** Sub-stage: batching | llm_call | retry | parse | normalize | fallback | done */
  stage: string;
  /** Human-readable detail. */
  detail: string;
  /** 1-based batch index within this extraction. */
  batchIndex?: number;
  /** Total batch count. */
  batchCount?: number;
  /** 1-based retry attempt within a batch (when stage === 'retry'). */
  attempt?: number;
  /** Number of entities parsed from the LLM response (when stage === 'parse'). */
  entityCount?: number;
  /** Estimated input tokens for this LLM call (when stage === 'llm_call' or 'parse'). */
  inputTokens?: number;
  /** Estimated output tokens for this LLM call (when stage === 'llm_call' or 'parse'). */
  outputTokens?: number;
}
export type ExtractProgressFn = (event: ExtractProgressEvent) => void;

export interface ExtractionOptions {
  /** Session or conversation identifier to scope extracted episodic nodes. */
  sessionId?: string;
  /** Agent identifier for agent-specific memory. */
  agentId?: string;
  /** Source id for provenance tracking. */
  sourceId?: string;
  /** Maximum number of nodes to extract per chunk. */
  maxNodesPerChunk?: number;
  /** Pre-categorized label if the input is known to be a tool, persona, etc. */
  category?: 'persona' | 'tool' | 'episodic' | 'semantic' | 'source_doc' | 'system';
  /** Optional GBNF grammar string for constrained generation (e.g. llama.cpp). */
  grammar?: string;
  /** Maximum tokens for the LLM generation. */
  maxTokens?: number;
  /** Chunk size in characters for long inputs. */
  chunkSize?: number;
  /** Chunk overlap in characters. */
  chunkOverlap?: number;
  /** Optional sub-stage progress callback for live UI telemetry. */
  onProgress?: ExtractProgressFn;
}

export interface GenerateFnOptions {
  /** JSON schema describing the expected output. */
  schema?: Record<string, unknown>;
  /** Optional GBNF grammar string. */
  grammar?: string;
  /** Maximum tokens for the generation. */
  maxTokens?: number;
}

export type GenerateFn = (prompt: string, options?: GenerateFnOptions) => Promise<string>;

/**
 * Batch TextUnits for LLM calls. Short units are grouped (up to ~1500 tokens
 * per call); long units get individual calls. This keeps the LLM call count
 * comparable to the old chunk-based approach while improving granularity.
 */
/**
 * Maximum number of LLM batches per extraction call. Beyond this, extraction
 * is skipped (the chunk is still stored with its embedding) to prevent runaway
 * processing on very large documents.
 */
const MAX_BATCHES_PER_EXTRACTION = 50;

function planLLMCalls(units: TextUnit[]): TextUnit[][] {
  const batches: TextUnit[][] = [];
  let current: TextUnit[] = [];
  let currentTokens = 0;
  const MAX_TOKENS_PER_CALL = 4000;

  for (const unit of units) {
    if (unit.tokenCount > MAX_TOKENS_PER_CALL) {
      if (current.length) { batches.push(current); current = []; currentTokens = 0; }
      batches.push([unit]);
      continue;
    }
    if (currentTokens + unit.tokenCount > MAX_TOKENS_PER_CALL) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(unit);
    currentTokens += unit.tokenCount;
  }
  if (current.length) batches.push(current);
  return batches;
}

const SEMANTIC_EDGE_TYPES: MemoryEdgeType[] = [
  'CAUSES', 'IS_A', 'PART_OF', 'HAS_PROPERTY', 'LOCATED_IN', 'OCCURRED_IN', 'MENTIONS',
  'LEADS_TO', 'INFLUENCES', 'CONTRIBUTES_TO', 'RESULTS_IN', 'DESCRIBES', 'EXAMPLES',
  'OPPOSES', 'SYNONYM', 'PRECEDES', 'FOLLOWS', 'REQUIRES', 'RELATED_TO', 'REFERENCES',
  'CONTAINS', 'NEXT_STEP', 'GENERATED_OUTPUT', 'USING_TOOL', 'SHARED_INSIGHT',
];

const nodeSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(120),
  category: z.enum(['persona', 'tool', 'episodic', 'semantic', 'source_doc', 'system']),
  content: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1).optional(),
});

const edgeSchema = z.object({
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  relationshipType: z.enum(SEMANTIC_EDGE_TYPES as [string, ...string[]]),
  weight: z.number().min(0).max(1).optional(),
  extractionMethod: z.enum(['EXTRACTED', 'INFERRED']).optional(),
});

export function createLocalLLMExtractor(modelName?: string): MemoryExtractor {
  const judge = new LocalLLMJudge({ modelName, maxNewTokens: 512, temperature: 0.1 });
  return new MemoryExtractor(async (prompt: string) => {
    try {
      return await judge.generate(prompt, { maxTokens: 512 });
    } catch (e) {
      // Fallback to simple text if WASM fails
      console.warn('Local LLM extraction failed, using fallback:', e instanceof Error ? e.message : e);
      return 'Extracted note';
    }
  });
}

export class MemoryExtractor {
  private _hasGenerate: boolean;
  constructor(private generate: GenerateFn, hasGenerate = true) {
    this._hasGenerate = hasGenerate;
  }

  /** True when a real LLM generate function is configured (not the empty fallback). */
  hasGenerate(): boolean {
    return this._hasGenerate;
  }

  /**
   * Extract a knowledge graph from raw text.
   *
   * Text is segmented into TextUnits via SemanticSegmenter,
   * then extracted per-batch with the LLM. Failed TextUnits become raw_fallback
   * nodes.
   */
  async extract(text: string, options: ExtractionOptions = {}): Promise<ExtractedMemory> {
    text = sanitizeIngestText(text);
    if (!text.trim()) return { nodes: [], edges: [] };

    // Segment into TextUnits using the type-aware segmenter.
    const units = segmentText(text, {
      sessionId: options.sessionId,
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap,
    });

    if (units.length === 0) return { nodes: [], edges: [] };

    return this.extractFromTextUnits(units, options);
  }

  /**
   * Extract a knowledge graph from pre-segmented TextUnits.
   *
   * TextUnits are batched (short ones grouped, long ones individual) to keep
   * LLM call count comparable to the old chunk-based approach. Each batch gets
   * one LLM call. Nodes from each batch inherit provenance from the batch's
   * TextUnits. Failed batches produce raw_fallback nodes.
   */
  async extractFromTextUnits(units: TextUnit[], options: ExtractionOptions = {}): Promise<ExtractedMemory> {
    const maxNodesPerChunk = options.maxNodesPerChunk ?? 50;
    const category = options.category ?? 'semantic';
    const maxTokens = options.maxTokens ?? 4096;
    const onProgress = options.onProgress;

    const batches = planLLMCalls(units);
    onProgress?.({ stage: 'batching', detail: `Planned ${batches.length} LLM batch(es) from ${units.length} text unit(s)`, batchCount: batches.length });

    // Safety cap: if the document is so large that extraction would require
    // too many LLM calls, skip extraction entirely. The chunk is still stored
    // with its embedding — the user can run community_summarize later for
    // deeper analysis. This prevents runaway processing (e.g. 833 batches
    // on an 8MB file = ~3.5 hours of LLM calls).
    if (batches.length > MAX_BATCHES_PER_EXTRACTION) {
      getLogger().warn('MEMORY_EXTRACT', `Skipping extraction: ${batches.length} batches exceeds cap of ${MAX_BATCHES_PER_EXTRACTION}. Chunk will be stored without entity extraction.`);
      onProgress?.({ stage: 'fallback', detail: `Extraction skipped — ${batches.length} batches exceeds cap of ${MAX_BATCHES_PER_EXTRACTION}. Chunk stored with embedding only.`, batchCount: batches.length });
      return { nodes: [], edges: [], llmCallCount: 0 };
    }
    const allNodes: MemoryNodeInput[] = [];
    const allEdges: MemoryEdgeInput[] = [];
    const labelToNodeId = new Map<string, string>();
    const failedUnits: TextUnit[] = [];

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]!;
      const batchText = batch.map((u) => u.text).join('\n\n');
      if (!batchText.trim()) continue;
      const batchNum = bi + 1;
      onProgress?.({ stage: 'llm_call', detail: `LLM batch ${batchNum}/${batches.length} — ${batchText.length} chars`, batchIndex: batchNum, batchCount: batches.length });

      const batchResult = await this.extractChunk(batchText, {
        ...options,
        maxNodesPerChunk,
        category,
        maxTokens,
      }, onProgress, batchNum, batches.length);

      if (batchResult.nodes.length === 0) {
        // LLM failed for this batch — collect units for raw_fallback.
        onProgress?.({ stage: 'fallback', detail: `Batch ${batchNum}/${batches.length} failed — queued for raw fallback`, batchIndex: batchNum, batchCount: batches.length });
        failedUnits.push(...batch);
        continue;
      }

      onProgress?.({ stage: 'parse', detail: `Parsed ${batchResult.nodes.length} entities from batch ${batchNum}/${batches.length}`, batchIndex: batchNum, batchCount: batches.length, entityCount: batchResult.nodes.length });

      // Attach provenance from the first unit in the batch.
      const firstUnit = batch[0]!;
      const chunkNodes: MemoryNodeInput[] = [];

      for (const node of batchResult.nodes) {
        const normalized = this.normalizeLabel(node.label);
        let existingId = labelToNodeId.get(normalized);
        if (!existingId) {
          const id = node.id ?? crypto.randomUUID();
          node.id = id;
          // Attach provenance.
          node.headingPath = firstUnit.source.headingPath;
          node.charSpan = [firstUnit.source.charStart, firstUnit.source.charEnd];
          node.unitType = firstUnit.type;
          labelToNodeId.set(normalized, id);
          chunkNodes.push(node);
          allNodes.push(node);
          existingId = id;
        } else if (node.id && node.id !== existingId) {
          for (const edge of batchResult.edges) {
            if (edge.sourceNodeId === node.id) edge.sourceNodeId = existingId;
            if (edge.targetNodeId === node.id) edge.targetNodeId = existingId;
          }
        }
      }

      const chunkNodeIds = new Set(chunkNodes.map((n) => n.id));
      for (const edge of batchResult.edges) {
        if (chunkNodeIds.has(edge.sourceNodeId) && chunkNodeIds.has(edge.targetNodeId)) {
          allEdges.push(edge);
        }
      }
      onProgress?.({ stage: 'normalize', detail: `Normalized ${chunkNodes.length} new entities from batch ${batchNum}/${batches.length} (total: ${allNodes.length})`, batchIndex: batchNum, batchCount: batches.length });
    }

    // Raw fallback: if ALL batches failed, create a SINGLE consolidated episodic
    // node for the whole text — not one per TextUnit. This prevents garbage
    // fragment nodes (e.g. "ts.\n- Example:...") from polluting the graph when
    // the LLM is unavailable. If some batches succeeded, skip failed units
    // entirely — partial extraction is better than fragment pollution.
    if (failedUnits.length > 0 && allNodes.length === 0) {
      onProgress?.({ stage: 'fallback', detail: `All ${batches.length} batch(es) failed — creating consolidated raw-fallback node`, batchCount: batches.length });
      const fullText = failedUnits.map((u) => u.text).join('\n\n');
      // Clean label: collapse whitespace, strip newlines, strip markdown.
      const cleanLabel = fullText.replace(/[#*`|]/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      const label = cleanLabel.length > 120 ? cleanLabel.slice(0, 117) + '...' : cleanLabel;
      const firstUnit = failedUnits[0]!;
      const lastUnit = failedUnits[failedUnits.length - 1]!;
      allNodes.push({
        id: crypto.randomUUID(),
        label,
        category: 'episodic',
        content: fullText,
        confidence: 0.3,
        sessionId: options.sessionId,
        agentId: options.agentId,
        sourceId: options.sourceId,
        headingPath: firstUnit.source.headingPath,
        charSpan: [firstUnit.source.charStart, lastUnit.source.charEnd],
        unitType: 'raw_fallback',
      });
    }

    onProgress?.({ stage: 'done', detail: `Extraction complete — ${allNodes.length} entities, ${allEdges.length} edges from ${batches.length} batch(es)`, batchCount: batches.length, entityCount: allNodes.length });
    return { ...filterDividerNodes(allNodes, allEdges), llmCallCount: batches.length };
  }

  private async extractChunk(
    text: string,
    options: Required<Pick<ExtractionOptions, 'maxNodesPerChunk' | 'category' | 'maxTokens'>> & ExtractionOptions,
    onProgress?: ExtractProgressFn,
    batchIndex?: number,
    batchCount?: number,
  ): Promise<ExtractedMemory> {
    const schema = this.buildJsonSchema(options.category, options.maxNodesPerChunk);
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = attempt === 0
        ? this.buildPrompt(text, options.category, options.maxNodesPerChunk)
        : this.buildRetryPrompt(text, options.category, options.maxNodesPerChunk, lastError);
      if (attempt > 0) {
        onProgress?.({ stage: 'retry', detail: `Retry ${attempt + 1}/3 for batch ${batchIndex ?? '?'}/${batchCount ?? '?'} — ${lastError instanceof Error ? lastError.message : String(lastError)}`, batchIndex, batchCount, attempt: attempt + 1 });
      }
      try {
        const raw = await this.generate(prompt, {
          schema,
          grammar: options.grammar,
          maxTokens: options.maxTokens,
        });
        if (!raw || !raw.trim()) {
          lastError = new Error('LLM returned empty response');
          continue;
        }
        // Estimate token usage from prompt/response length (~3.5 chars/token).
        const inTok = countInputTokens(prompt);
        const outTok = estimateOutputTokens(raw);
        onProgress?.({ stage: 'parse', detail: `Parsed LLM response for batch ${batchIndex ?? '?'}/${batchCount ?? '?'}`, batchIndex, batchCount, entityCount: 0, inputTokens: inTok, outputTokens: outTok });
        const result = this.parse(raw, options);
        if (result.nodes.length > 0) {
          onProgress?.({ stage: 'parse', detail: `Parsed ${result.nodes.length} entities from batch ${batchIndex ?? '?'}/${batchCount ?? '?'}`, batchIndex, batchCount, entityCount: result.nodes.length, inputTokens: inTok, outputTokens: outTok });
          return result;
        }
        lastError = new Error('No nodes extracted');
      } catch (e) {
        lastError = e;
      }
    }

    getLogger().warn('MEMORY_EXTRACT', `LLM extraction failed after 3 retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return { nodes: [], edges: [] };
  }

  /**
   * Attempt to repair truncated JSON by closing open strings, arrays, and objects.
   * This salvages partial LLM output when maxTokens cuts off the response mid-JSON.
   */
  private repairTruncatedJson(json: string): string {
    let s = json.trimEnd();
    // Remove any trailing partial key/value (text after the last complete value).
    // Find the last complete JSON token: }, ], ", or a number/boolean/null.
    // Then close all open structures.
    let inString = false;
    let escape = false;
    const depth: ('obj' | 'arr')[] = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth.push('obj');
      else if (ch === '[') depth.push('arr');
      else if (ch === '}' || ch === ']') depth.pop();
    }
    // If we're in an open string, close it.
    if (inString) s += '"';
    // Close open arrays and objects.
    while (depth.length > 0) {
      const top = depth.pop()!;
      if (top === 'arr') s += ']';
      else s += '}';
    }
    return s;
  }

  /**
   * Clean common LLM JSON mistakes that are NOT truncation:
   * - Markdown fences (```json ... ```)
   * - Unquoted property names: {label: "foo"} → {"label": "foo"}
   * - Single-quoted strings: 'foo' → "foo"
   * - Trailing commas: [1,2,] → [1,2]  /  {"a":1,} → {"a":1}
   * - JS-style comments
   * Also extracts the outermost JSON object if the LLM wrapped it in prose.
   */
  private cleanJsonResponse(raw: string): string {
    let s = raw.trim();
    // Strip markdown fences.
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
    // Strip JS-style comments.
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Extract the outermost JSON object if there's prose around it.
    const firstBrace = s.indexOf('{');
    const lastBrace = s.lastIndexOf('}');
    if (firstBrace > 0 || (lastBrace >= 0 && lastBrace < s.length - 1)) {
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        s = s.slice(firstBrace, lastBrace + 1);
      }
    }
    // Fix unquoted property names: {label: → {"label":
    // Matches word characters (and underscores) followed by a colon, but only
    // outside of double-quoted strings.
    s = this.quoteUnquotedKeys(s);
    // Convert single-quoted strings to double-quoted.
    s = this.singleToDoubleQuotes(s);
    // Remove trailing commas before ] or }.
    s = s.replace(/,\s*([}\]])/g, '$1');
    return s.trim();
  }

  /** Quote unquoted JSON property names (outside of string values). */
  private quoteUnquotedKeys(s: string): string {
    let result = '';
    let inString = false;
    let escape = false;
    let i = 0;
    while (i < s.length) {
      const ch = s[i]!;
      if (escape) { result += ch; escape = false; i++; continue; }
      if (ch === '\\' && inString) { result += ch; escape = true; i++; continue; }
      if (ch === '"') { inString = !inString; result += ch; i++; continue; }
      if (inString) { result += ch; i++; continue; }
      // Outside a string: look for identifier: pattern (unquoted key).
      if (ch !== '"' && ch !== '{' && ch !== ',' && ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '[') {
        // Try to match an identifier followed by a colon.
        const rest = s.slice(i);
        const match = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (match && match[1]) {
          result += `"${match[1]}":`;
          i += match[0].length;
          continue;
        }
      }
      result += ch;
      i++;
    }
    return result;
  }

  /** Convert single-quoted strings to double-quoted (handles escaped singles). */
  private singleToDoubleQuotes(s: string): string {
    let result = '';
    let inDouble = false;
    let inSingle = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (escape) { result += ch; escape = false; continue; }
      if (ch === '\\' && (inDouble || inSingle)) {
        // If inside single quotes, convert \' to '
        if (inSingle && s[i + 1] === "'") { result += "'"; i++; continue; }
        result += ch; escape = true; continue;
      }
      if (ch === '"' && !inSingle) { inDouble = !inDouble; result += ch; continue; }
      if (ch === "'" && !inDouble) {
        if (inSingle) { inSingle = false; result += '"'; continue; }
        // Check if this single quote starts a string (preceded by : , [ { or whitespace)
        const prev = result.trimEnd().slice(-1);
        if (prev === '' || prev === ':' || prev === ',' || prev === '[' || prev === '{') {
          inSingle = true; result += '"'; continue;
        }
        result += ch; continue;
      }
      result += ch;
    }
    return result;
  }

  private parse(raw: string, options: ExtractionOptions): ExtractedMemory {
    // Step 1: clean common LLM JSON mistakes (unquoted keys, single quotes,
    // trailing commas, markdown fences, surrounding prose).
    const cleaned = this.cleanJsonResponse(raw);
    let parsed: { nodes?: unknown[]; edges?: unknown[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Step 2: the cleaned JSON may still be truncated (maxTokens cut off
      // mid-string). Close open structures and retry.
      try {
        const repaired = this.repairTruncatedJson(cleaned);
        parsed = JSON.parse(repaired);
      } catch {
        // Step 3: last resort — try to extract just the nodes array via regex.
        // This salvages cases where the edges array is malformed but nodes are intact.
        const nodesMatch = cleaned.match(/"nodes"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
        if (nodesMatch && nodesMatch[1]) {
          try {
            const nodesJson = this.repairTruncatedJson(nodesMatch[1]);
            const nodesParsed = JSON.parse(nodesJson);
            parsed = { nodes: nodesParsed, edges: [] };
          } catch {
            throw new Error('Failed to parse LLM JSON output after cleaning and repair');
          }
        } else {
          throw new Error('Failed to parse LLM JSON output after cleaning and repair');
        }
      }
    }

    // Validate nodes strictly (bad nodes = bad extraction), but validate edges
    // leniently — if the LLM returns an invalid relationship type, skip that
    // edge rather than failing the entire batch and losing all nodes.
    const validNodeSet = z.array(nodeSchema).max(options.maxNodesPerChunk ?? 50);
    const validatedNodes = validNodeSet.parse(parsed.nodes ?? []);

    // Lenient edge validation: parse individually, skip invalid ones.
    const validEdgeTypes = new Set(SEMANTIC_EDGE_TYPES as string[]);
    const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
    const validEdges: z.infer<typeof edgeSchema>[] = [];
    for (const e of rawEdges) {
      const edge = e as Record<string, unknown>;
      if (!edge || typeof edge.sourceNodeId !== 'string' || typeof edge.targetNodeId !== 'string') continue;
      const relType = String(edge.relationshipType ?? '').toUpperCase();
      if (!validEdgeTypes.has(relType)) continue;
      validEdges.push({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        relationshipType: relType as MemoryEdgeType,
        weight: typeof edge.weight === 'number' ? edge.weight : undefined,
        extractionMethod: edge.extractionMethod === 'EXTRACTED' || edge.extractionMethod === 'INFERRED' ? edge.extractionMethod : undefined,
      });
    }

    const validated = { nodes: validatedNodes, edges: validEdges };

    // The LLM may return arbitrary string ids (e.g. "e1", "entity_2", "1", "2") or
    // even use node labels as edge source/target. We need stable UUIDs for the
    // database, so map every LLM id AND every label to a generated UUID and
    // rewrite edges accordingly. Nodes without explicit ids get synthetic
    // 1-based positional ids so edges can still reference them.
    const idMap = new Map<string, string>();
    const labelMap = new Map<string, string>();
    const nodes = validated.nodes.map((n, index) => {
      const generatedId = crypto.randomUUID();
      const llmId = n.id ?? String(index + 1);
      idMap.set(llmId, generatedId);
      // Also map by label (case-insensitive) — LLMs often use labels as edge refs.
      const normalizedLabel = n.label.toLowerCase().trim();
      if (!labelMap.has(normalizedLabel)) labelMap.set(normalizedLabel, generatedId);
      return {
        ...n,
        id: generatedId,
        sessionId: options.sessionId,
        agentId: options.agentId,
        sourceId: options.sourceId,
        confidence: n.confidence ?? 0.8,
      };
    }) as MemoryNodeInput[];

    const resolveEdgeRef = (ref: string): string | null => {
      // Try exact id match first.
      if (idMap.has(ref)) return idMap.get(ref)!;
      // Try label match (case-insensitive).
      const byLabel = labelMap.get(ref.toLowerCase().trim());
      if (byLabel) return byLabel;
      // Try as positional id (1-based).
      if (idMap.has(ref)) return idMap.get(ref)!;
      return null;
    };

    const edges: MemoryEdgeInput[] = [];
    for (const e of validated.edges) {
      const src = resolveEdgeRef(e.sourceNodeId);
      const tgt = resolveEdgeRef(e.targetNodeId);
      if (!src || !tgt) continue;
      edges.push({
        sourceNodeId: src,
        targetNodeId: tgt,
        relationshipType: e.relationshipType as MemoryEdgeType,
        weight: e.weight ?? (e.extractionMethod === 'EXTRACTED' ? 0.9 : 0.5),
        extractionMethod: e.extractionMethod ?? 'INFERRED',
      });
    }

    return { nodes, edges };
  }

  private buildJsonSchema(category: string, maxNodes: number): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          maxItems: maxNodes,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string', maxLength: 120, description: 'Short entity, concept, or fact name (e.g. "Global Warming", "Chicxulub Impact")' },
              category: { type: 'string', enum: ['persona', 'tool', 'episodic', 'semantic', 'source_doc', 'system'], default: category },
              content: { type: 'string', maxLength: 4000, description: 'Concise description of the entity/fact/concept' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['label', 'category', 'content'],
          },
        },
        edges: {
          type: 'array',
          maxItems: maxNodes * 2,
          items: {
            type: 'object',
            properties: {
              sourceNodeId: { type: 'string', description: 'Must match a node id' },
              targetNodeId: { type: 'string', description: 'Must match a node id' },
              relationshipType: { type: 'string', enum: SEMANTIC_EDGE_TYPES, description: 'Semantic relationship between the two entities' },
              weight: { type: 'number', minimum: 0, maximum: 1 },
              extractionMethod: { type: 'string', enum: ['EXTRACTED', 'INFERRED'], description: 'EXTRACTED = directly stated in text, INFERRED = you inferred it' },
            },
            required: ['sourceNodeId', 'targetNodeId', 'relationshipType'],
          },
        },
      },
      required: ['nodes', 'edges'],
    };
  }

  private buildPrompt(text: string, category: string, maxNodes: number): string {
    return `You are a knowledge extraction engine. Dissolve the input text into a dense knowledge graph of atomic entities, concepts, and facts connected by semantic relationships.

Return ONLY a JSON object matching the schema below.

Schema:
${JSON.stringify(this.buildJsonSchema(category, maxNodes), null, 2)}

Extraction rules (follow these strictly):
1. Extract as many distinct entities, concepts, facts, and events as the text contains. Aim for a rich graph, not a summary.
2. Nodes must be atomic:
   - label = a short, specific name (e.g. "Chicxulub Impact", "Greenhouse Effect", "Permian-Triassic Extinction")
   - content = a concise 1-3 sentence description
   - category = "${category}" unless the text clearly describes a person, tool, source document, or system event.
3. Edges must express real semantic relationships between nodes (subject-relationship-object):
   - Use relationship types like CAUSES, IS_A, PART_OF, HAS_PROPERTY, LOCATED_IN, OCCURRED_IN, MENTIONS, LEADS_TO, INFLUENCES, CONTRIBUTES_TO, RESULTS_IN, DESCRIBES, EXAMPLES, REQUIRES, RELATED_TO, PRECEDES, FOLLOWS, CONTAINS, NEXT_STEP.
   - Every important node should have at least one edge connecting it to another node.
   - For each edge, set extractionMethod: "EXTRACTED" if the relationship is directly stated in the text, or "INFERRED" if you inferred it from context.
4. Prefer typed entities: events, processes, locations, time periods, quantities, organisms, organizations, technologies, theories, causes, effects.
5. If the text contains a list (e.g. "5 mass extinctions"), create one node per list item plus a parent node that links to each item with CONTAINS or EXAMPLES.
6. Edges must connect nodes by their id values with a valid relationship_type.
7. Return at most ${maxNodes} nodes and ${maxNodes * 2} edges.
8. For each node, set confidence (0.0–1.0) to reflect extraction quality:
   - 0.9–1.0: explicitly stated fact or named entity directly from the text
   - 0.7–0.9: clearly implied but not directly stated
   - 0.5–0.7: inferred from context, may be speculative
   - Below 0.5: uncertain or tangential — do NOT include these
9. Return ONLY the JSON object, no markdown fences, no explanation.

Input text to analyze:
"""${text}"""`;
  }

  private buildRetryPrompt(text: string, category: string, maxNodes: number, lastError: unknown): string {
    return `${this.buildPrompt(text, category, maxNodes)}

WARNING: The previous attempt failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}. Make sure to return strictly valid JSON matching the schema above, with every edge referencing a valid node id.`;
  }

  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
