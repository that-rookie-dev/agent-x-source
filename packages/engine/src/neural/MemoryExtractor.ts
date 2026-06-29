/**
 * GraphRAG-style memory extraction protocol.
 *
 * Turns arbitrary text (chat messages, documents, tool outputs) into a rich
 * knowledge graph of atomic entities, concepts, facts, and typed relationships
 * suitable for the unified MemoryFabric.
 *
 * Implements:
 * - Semantic text chunking into analyzable TextUnits (like GraphRAG)
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

export interface ExtractedMemory {
  nodes: MemoryNodeInput[];
  edges: MemoryEdgeInput[];
}

export interface ExtractionOptions {
  /** Session or conversation identifier to scope extracted episodic nodes. */
  sessionId?: string;
  /** Agent identifier for agent-specific memory. */
  agentId?: string;
  /** Source id for provenance tracking. */
  sourceId?: string;
  /** Maximum number of nodes to extract per chunk. */
  maxNodesPerChunk?: number;
  /** Maximum number of semantic chunks to create from long input. */
  maxChunks?: number;
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
  constructor(private generate: GenerateFn) {}

  async extract(text: string, options: ExtractionOptions = {}): Promise<ExtractedMemory> {
    const maxNodesPerChunk = options.maxNodesPerChunk ?? 50;
    const maxChunks = options.maxChunks ?? 8;
    const chunkSize = options.chunkSize ?? 2500;
    const chunkOverlap = options.chunkOverlap ?? 250;
    const category = options.category ?? 'semantic';
    const maxTokens = options.maxTokens ?? 2048;

    // If the text is short enough, extract directly; otherwise chunk it.
    const chunks = text.length <= chunkSize
      ? [text]
      : this.chunkText(text, chunkSize, chunkOverlap).slice(0, maxChunks);

    const allNodes: MemoryNodeInput[] = [];
    const allEdges: MemoryEdgeInput[] = [];
    const labelToNodeId = new Map<string, string>();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk || !chunk.trim()) continue;

      const chunkNodes: MemoryNodeInput[] = [];
      const chunkResult = await this.extractChunk(chunk, {
        ...options,
        maxNodesPerChunk,
        category,
        maxTokens,
      });

      // Deduplicate by normalized label within this chunk and across chunks.
      for (const node of chunkResult.nodes) {
        const normalized = this.normalizeLabel(node.label);
        let existingId = labelToNodeId.get(normalized);
        if (!existingId) {
          const id = node.id ?? crypto.randomUUID();
          node.id = id;
          labelToNodeId.set(normalized, id);
          chunkNodes.push(node);
          allNodes.push(node);
          existingId = id;
        } else if (node.id && node.id !== existingId) {
          // Rewrite any edges in this chunk that pointed to the duplicate id.
          for (const edge of chunkResult.edges) {
            if (edge.sourceNodeId === node.id) edge.sourceNodeId = existingId;
            if (edge.targetNodeId === node.id) edge.targetNodeId = existingId;
          }
        }
      }

      // Keep only edges whose endpoints survived deduplication and are present in this chunk.
      const chunkNodeIds = new Set(chunkNodes.map((n) => n.id));
      for (const edge of chunkResult.edges) {
        if (chunkNodeIds.has(edge.sourceNodeId) && chunkNodeIds.has(edge.targetNodeId)) {
          allEdges.push(edge);
        }
      }
    }

    // If the LLM could not extract anything, use the heuristic fallback so the user still gets
    // a meaningful set of atomic nodes instead of one giant blob.
    if (allNodes.length === 0) {
      return this.heuristicExtract(text, options);
    }

    return { nodes: allNodes, edges: allEdges };
  }

  private async extractChunk(text: string, options: Required<Pick<ExtractionOptions, 'maxNodesPerChunk' | 'category' | 'maxTokens'>> & ExtractionOptions): Promise<ExtractedMemory> {
    const schema = this.buildJsonSchema(options.category, options.maxNodesPerChunk);
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = attempt === 0
        ? this.buildPrompt(text, options.category, options.maxNodesPerChunk)
        : this.buildRetryPrompt(text, options.category, options.maxNodesPerChunk, lastError);
      try {
        const raw = await this.generate(prompt, {
          schema,
          grammar: options.grammar,
          maxTokens: options.maxTokens,
        });
        const result = this.parse(raw, options);
        if (result.nodes.length > 0) return result;
        lastError = new Error('No nodes extracted');
      } catch (e) {
        lastError = e;
      }
    }

    // Fallback for this chunk: use the heuristic extractor so a failed LLM call still yields
    // multiple atomic nodes from headings and list items.
    return this.heuristicExtract(text, options);
  }

  private parse(raw: string, options: ExtractionOptions): ExtractedMemory {
    const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    const validated = z.object({
      nodes: z.array(nodeSchema).max(options.maxNodesPerChunk ?? 50),
      edges: z.array(edgeSchema).max((options.maxNodesPerChunk ?? 50) * 2),
    }).parse(parsed);

    // The LLM may return arbitrary string ids (e.g. "e1", "entity_2", "1", "2"). We need
    // stable UUIDs for the database, so map every LLM id to a generated UUID and rewrite
    // edges accordingly. Nodes without explicit ids get synthetic 1-based positional ids
    // so edges can still reference them.
    const idMap = new Map<string, string>();
    const nodes = validated.nodes.map((n, index) => {
      const generatedId = crypto.randomUUID();
      const llmId = n.id ?? String(index + 1);
      idMap.set(llmId, generatedId);
      return {
        ...n,
        id: generatedId,
        sessionId: options.sessionId,
        agentId: options.agentId,
        sourceId: options.sourceId,
        confidence: n.confidence ?? 0.8,
      };
    }) as MemoryNodeInput[];

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = validated.edges
      .filter((e) => nodeIds.has(idMap.get(e.sourceNodeId) ?? e.sourceNodeId) && nodeIds.has(idMap.get(e.targetNodeId) ?? e.targetNodeId))
      .map((e) => ({
        ...e,
        sourceNodeId: idMap.get(e.sourceNodeId) ?? e.sourceNodeId,
        targetNodeId: idMap.get(e.targetNodeId) ?? e.targetNodeId,
        weight: e.weight ?? 0.5,
      })) as MemoryEdgeInput[];

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
            },
            required: ['sourceNodeId', 'targetNodeId', 'relationshipType'],
          },
        },
      },
      required: ['nodes', 'edges'],
    };
  }

  private buildPrompt(text: string, category: string, maxNodes: number): string {
    return `You are a GraphRAG-style knowledge extraction engine. Dissolve the input text into a dense knowledge graph of atomic entities, concepts, and facts connected by semantic relationships.

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
4. Prefer typed entities: events, processes, locations, time periods, quantities, organisms, organizations, technologies, theories, causes, effects.
5. If the text contains a list (e.g. "5 mass extinctions"), create one node per list item plus a parent node that links to each item with CONTAINS or EXAMPLES.
6. Edges must connect nodes by their id values with a valid relationship_type.
7. Return at most ${maxNodes} nodes and ${maxNodes * 2} edges.
8. Return ONLY the JSON object, no markdown fences, no explanation.

Input text to analyze:
"""${text}"""`;
  }

  private buildRetryPrompt(text: string, category: string, maxNodes: number, lastError: unknown): string {
    return `${this.buildPrompt(text, category, maxNodes)}

WARNING: The previous attempt failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}. Make sure to return strictly valid JSON matching the schema above, with every edge referencing a valid node id.`;
  }

  /**
   * Splits text into semantic chunks preserving headings, paragraphs, and list items.
   * Recognizes markdown headings, bold headings, all-caps/title-case section titles,
   * and bullet/numbered lists as natural split points. Long units are further split
   * into sentences so no chunk exceeds the requested size.
   */
  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const units = this.splitIntoSemanticUnits(text);
    const chunks: string[] = [];
    let current = '';
    let lastHeading = '';

    const pushCurrent = () => {
      if (current.trim()) {
        chunks.push(this.finalizeChunk(current, lastHeading));
      }
    };

    for (const unit of units) {
      const trimmed = unit.trim();
      if (!trimmed) continue;

      const isHeading = this.isHeadingLine(trimmed);
      if (isHeading) {
        pushCurrent();
        lastHeading = trimmed;
        current = '';
        continue;
      }

      // If the unit itself is too large, split it into smaller pieces before chunking.
      const pieces = trimmed.length > chunkSize ? this.splitLongUnit(trimmed, chunkSize) : [trimmed];

      for (const piece of pieces) {
        if (!piece.trim()) continue;
        if (current.length + piece.length + 1 > chunkSize && current.trim()) {
          pushCurrent();
          const overlapText = current.slice(-overlap);
          current = overlapText ? overlapText + '\n' + piece : piece;
        } else {
          current = current ? current + '\n' + piece : piece;
        }
      }
    }

    pushCurrent();
    return chunks.filter((c) => c.trim().length > 0);
  }

  private splitIntoSemanticUnits(text: string): string[] {
    // Preserve list items and paragraphs as distinct units so lists are not collapsed.
    return text
      .split(/\n(?=\s*[-*•]\s+|\s*\d+\.\s+|\s*#{1,6}\s+|\s*\*\*.+\*\*\s*$)/)
      .flatMap((unit) => {
        const trimmed = unit.trim();
        if (!trimmed) return [];
        // Split a long non-list paragraph into sentences only if it has no internal line breaks.
        if (!trimmed.includes('\n') && !/^[-*•]\s/.test(trimmed) && !/^\d+\.\s/.test(trimmed) && trimmed.length > 800) {
          return trimmed.match(/[^.!?]+[.!?]+\s*/g) ?? [trimmed];
        }
        return [trimmed];
      });
  }

  private splitLongUnit(unit: string, chunkSize: number): string[] {
    const sentences = unit.match(/[^.!?]+[.!?]+\s*/g) ?? [unit];
    const pieces: string[] = [];
    let current = '';
    for (const sentence of sentences) {
      if (current.length + sentence.length > chunkSize && current.trim()) {
        pieces.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) pieces.push(current.trim());
    return pieces.length > 0 ? pieces : [unit];
  }

  private isHeadingLine(line: string): boolean {
    const trimmed = line.trim();
    // Headings must be a single line.
    if (trimmed.includes('\n')) return false;
    if (/^#{1,6}\s+/.test(trimmed)) return true;
    if (/^\*\*.+\*\*$/.test(trimmed)) return true;
    if (/^[A-Z][A-Z\s&]{2,60}$/.test(trimmed)) return true;
    if (/^[A-Z][a-zA-Z\s&]{2,60}$/.test(trimmed) && trimmed.length < 60 && trimmed.split(/\s+/).length <= 6) return true;
    if (/^.+:\s*$/.test(trimmed) && trimmed.length < 80) return true;
    return false;
  }

  private finalizeChunk(content: string, heading: string): string {
    const trimmed = content.trim();
    return heading && !trimmed.startsWith(heading) ? `${heading}\n${trimmed}` : trimmed;
  }

  /**
   * Last-resort heuristic extraction used when the LLM cannot produce valid JSON.
   * Splits the text into sections and list items and turns them into a connected graph.
   * This guarantees multiple atomic nodes even from a local model that lacks structured output.
   */
  private heuristicExtract(text: string, options: ExtractionOptions): ExtractedMemory {
    const sections = this.splitIntoSections(text);
    const nodes: MemoryNodeInput[] = [];
    const edges: MemoryEdgeInput[] = [];
    let previousLeafId: string | null = null;

    for (const section of sections) {
      if (!section.title && !section.items.length) continue;

      const parentId = crypto.randomUUID();
      nodes.push({
        id: parentId,
        label: section.title || this.fallbackLabel(section.items[0] ?? text),
        category: options.category ?? 'semantic',
        content: section.items.slice(0, 3).join('\n').slice(0, 4000) || section.title || text.slice(0, 4000),
        sessionId: options.sessionId,
        agentId: options.agentId,
        sourceId: options.sourceId,
        confidence: 0.6,
      });

      const splitItems = section.items.flatMap((item) => this.splitItemIntoSentences(item));
      for (let i = 0; i < splitItems.length; i++) {
        const item = splitItems[i];
        if (!item) continue;
        const itemId = crypto.randomUUID();
        nodes.push({
          id: itemId,
          label: item.length > 120 ? item.slice(0, 117) + '...' : item,
          category: options.category ?? 'semantic',
          content: item,
          sessionId: options.sessionId,
          agentId: options.agentId,
          sourceId: options.sourceId,
          confidence: 0.6,
        });
        edges.push({
          sourceNodeId: parentId,
          targetNodeId: itemId,
          relationshipType: 'CONTAINS',
          weight: 0.8,
        });
        if (previousLeafId) {
          edges.push({
            sourceNodeId: previousLeafId,
            targetNodeId: itemId,
            relationshipType: 'NEXT_STEP',
            weight: 0.3,
          });
        }
        previousLeafId = itemId;
      }
    }

    if (nodes.length === 0) {
      return this.fallbackSingleNode(text, options);
    }

    return { nodes, edges };
  }

  private splitIntoSections(text: string): Array<{ title: string; items: string[] }> {
    const lines = text.split('\n');
    const sections: Array<{ title: string; items: string[] }> = [];
    let current: { title: string; items: string[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (this.isHeadingLine(trimmed)) {
        if (current) sections.push(current);
        current = { title: this.cleanHeading(trimmed), items: [] };
      } else if (current) {
        const items = this.splitListItem(trimmed);
        current.items.push(...items);
      } else {
        current = { title: '', items: this.splitListItem(trimmed) };
      }
    }

    if (current) sections.push(current);

    // If no real sections were found, split the whole text into sentences.
    const onlySection = sections[0];
    if (sections.length === 0 || (sections.length === 1 && onlySection && onlySection.title === '' && onlySection.items.length === 0)) {
      return [{ title: this.fallbackLabel(text), items: text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 10) }];
    }

    return sections;
  }

  private splitListItem(line: string): string[] {
    const trimmed = line.trim();
    if (/^[-*•]\s+/.test(trimmed)) return [trimmed.replace(/^[-*•]\s+/, '')];
    if (/^\d+\.\s+/.test(trimmed)) return [trimmed.replace(/^\d+\.\s+/, '')];
    return [trimmed];
  }

  private splitItemIntoSentences(item: string): string[] {
    const trimmed = item.trim();
    const sentences = trimmed
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
    return sentences.length > 0 ? sentences : [trimmed];
  }

  private cleanHeading(line: string): string {
    return line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\*\*/, '')
      .replace(/\*\*$/, '')
      .replace(/:\s*$/, '')
      .trim();
  }

  private fallbackSingleNode(text: string, options: ExtractionOptions): ExtractedMemory {
    return {
      nodes: [{
        id: crypto.randomUUID(),
        label: this.fallbackLabel(text),
        category: options.category ?? 'semantic',
        content: text.slice(0, 4000),
        sessionId: options.sessionId,
        agentId: options.agentId,
        sourceId: options.sourceId,
        confidence: 0.5,
      }],
      edges: [],
    };
  }

  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private fallbackLabel(text: string): string {
    // Try to extract a meaningful fallback label from the first heading or first sentence.
    const headingMatch = text.match(/^#{1,6}\s*(.+)/m);
    if (headingMatch?.[1]) return headingMatch[1].slice(0, 120);
    const firstSentence = text.split(/[.!?]\s+/)[0];
    if (firstSentence && firstSentence.length <= 120 && firstSentence.length > 3) return firstSentence;
    return 'Extracted note';
  }
}
