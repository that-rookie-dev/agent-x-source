/**
 * Memory extraction protocol.
 *
 * Turns arbitrary text (chat messages, documents, tool outputs) into atomic
 * memory nodes and typed edges suitable for the unified MemoryFabric.
 *
 * Implements:
 * - Zod schema validation for the LLM output
 * - Up to 2 self-healing retries with a stricter JSON-schema prompt
 * - Optional GBNF grammar hint (passed to the generator for backends that support it)
 * - A built-in local LLM generator factory via LocalLLMJudge
 */
import { z } from 'zod';
import type { MemoryNodeInput, MemoryEdgeInput } from './MemoryFabric.js';
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
  /** Maximum number of nodes to extract. */
  maxNodes?: number;
  /** Pre-categorized label if the input is known to be a tool, persona, etc. */
  category?: 'persona' | 'tool' | 'episodic' | 'semantic' | 'source_doc' | 'system';
  /** Optional GBNF grammar string for constrained generation (e.g. llama.cpp). */
  grammar?: string;
}

export interface GenerateFnOptions {
  /** JSON schema describing the expected output. */
  schema?: Record<string, unknown>;
  /** Optional GBNF grammar string. */
  grammar?: string;
}

export type GenerateFn = (prompt: string, options?: GenerateFnOptions) => Promise<string>;

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
  relationshipType: z.enum(['CONTAINS', 'REFERENCES', 'NEXT_STEP', 'REQUIRES', 'RELATED_TO', 'GENERATED_OUTPUT', 'USING_TOOL', 'SHARED_INSIGHT']),
  weight: z.number().min(0).max(1).optional(),
});

const extractionSchema = z.object({
  nodes: z.array(nodeSchema).max(20),
  edges: z.array(edgeSchema).max(40),
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
    const maxNodes = options.maxNodes ?? 5;
    const category = options.category ?? 'semantic';
    const schema = this.buildJsonSchema(category, maxNodes);
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = attempt === 0
        ? this.buildPrompt(text, category, maxNodes)
        : this.buildRetryPrompt(text, category, maxNodes, lastError);
      try {
        const raw = await this.generate(prompt, { schema, grammar: options.grammar });
        const result = this.parse(raw, options);
        if (result.nodes.length > 0) return result;
        lastError = new Error('No nodes extracted');
      } catch (e) {
        lastError = e;
      }
    }

    // Final fallback: single node with the raw text.
    return {
      nodes: [{
        label: 'Extracted note',
        category,
        content: text,
        sessionId: options.sessionId,
        agentId: options.agentId,
        sourceId: options.sourceId,
      }],
      edges: [],
    };
  }

  private parse(raw: string, options: ExtractionOptions): ExtractedMemory {
    const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);
    const validated = extractionSchema.parse(parsed);

    const nodes = validated.nodes.slice(0, options.maxNodes ?? 5).map((n) => ({
      ...n,
      id: n.id ?? crypto.randomUUID(),
      sessionId: options.sessionId,
      agentId: options.agentId,
      sourceId: options.sourceId,
      confidence: n.confidence ?? 0.8,
    })) as MemoryNodeInput[];

    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = validated.edges
      .filter((e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId))
      .slice(0, (options.maxNodes ?? 5) * 2)
      .map((e) => ({ ...e, weight: e.weight ?? 0.5 })) as MemoryEdgeInput[];

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
              label: { type: 'string', maxLength: 120 },
              category: { type: 'string', enum: ['persona', 'tool', 'episodic', 'semantic', 'source_doc', 'system'], default: category },
              content: { type: 'string', maxLength: 4000 },
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
              sourceNodeId: { type: 'string' },
              targetNodeId: { type: 'string' },
              relationshipType: { type: 'string', enum: ['CONTAINS', 'REFERENCES', 'NEXT_STEP', 'REQUIRES', 'RELATED_TO', 'GENERATED_OUTPUT', 'USING_TOOL', 'SHARED_INSIGHT'] },
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
    return `Extract atomic memory units from the following text. Return ONLY a JSON object matching the schema below.

Schema:
${JSON.stringify(this.buildJsonSchema(category, maxNodes), null, 2)}

Rules:
- Mimic a human brain: dissolve the text into atomic concepts, entities, and facts, not whole sentences or transcripts.
- Prefer subject-relationship-object triplets: each edge should express a clear relationship between two atomic neurons.
- Nodes should be atomic facts or concepts, not full sentences.
- Use category "${category}" as the default unless the text clearly describes a tool, person, source document, or conversation event.
- Edges must connect nodes by their id values with a valid relationship_type.
- Return at most ${maxNodes} nodes and ${maxNodes * 2} edges.
- Return ONLY the JSON object, no markdown fences, no explanation.

Text:
"""${text}"""`;
  }

  private buildRetryPrompt(text: string, category: string, maxNodes: number, lastError: unknown): string {
    return `${this.buildPrompt(text, category, maxNodes)}

WARNING: The previous attempt failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}. Make sure to return strictly valid JSON matching the schema above.`;
  }
}
