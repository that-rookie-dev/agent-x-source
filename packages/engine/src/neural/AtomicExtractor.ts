/**
 * Atomic-Level Dynamic Extraction Engine
 * 
 * Extracts nodes based on actual content complexity, not fixed ratios.
 * Analyzes text to determine optimal granularity dynamically.
 */

import type { MemoryNodeInput, MemoryEdgeInput, MemoryEdgeType } from './MemoryFabric.js';
import type { GenerateFn } from './MemoryExtractor.js';

export interface AtomicExtractionOptions {
  /** Cluster/session identifier */
  clusterId: string;
  /** Source identifier */
  sourceId?: string;
  /** LLM generator function */
  generate: GenerateFn;
  /** Embedding generator */
  embed?: (text: string) => Promise<number[]>;
  /** Maximum edges per node (anti-centralization) */
  maxEdgesPerNode?: number;
  /** Minimum depth tiers */
  minDepthTiers?: number;
  /** Extraction mode: 'atomic' (maximum detail) | 'balanced' | 'sparse' */
  granularity?: 'atomic' | 'balanced' | 'sparse';
}

export interface AtomicResult {
  nodes: MemoryNodeInput[];
  edges: MemoryEdgeInput[];
  topology: {
    totalNodes: number;
    totalEdges: number;
    maxDepth: number;
    avgEdgesPerNode: number;
    maxEdgesPerNode: number;
    violatesConstraints: boolean;
    violations: string[];
  };
  analysis: {
    textComplexity: number;
    conceptDensity: number;
    extractionRatio: number; // actual nodes per 100 words
    technicalTerms: number;
    relationships: number;
  };
}

interface TextAnalysis {
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  technicalTerms: string[];
  entities: string[];
  concepts: string[];
  relationships: Array<{ subject: string; predicate: string; object: string }>;
  complexity: number; // 0-1 scale
  conceptDensity: number; // concepts per 100 words
}

/**
 * Truly dynamic atomic-level extractor
 */
export class AtomicExtractor {
  private readonly maxEdgesPerNode: number;
  private readonly minDepthTiers: number;
  private readonly granularity: 'atomic' | 'balanced' | 'sparse';

  constructor(private options: AtomicExtractionOptions) {
    this.maxEdgesPerNode = options.maxEdgesPerNode ?? 7;
    this.minDepthTiers = options.minDepthTiers ?? 4;
    this.granularity = options.granularity ?? 'atomic';
  }

  /**
   * Extract nodes dynamically based on content analysis
   */
  async extract(text: string): Promise<AtomicResult> {
    // Step 1: Analyze text to determine optimal extraction strategy
    const analysis = this.analyzeText(text);

    // Step 2: Extract based on actual content, not fixed ratios
    const rawStructure = await this.extractAtomicStructure(text, analysis);

    // Step 3: Verify topology constraints
    const { nodes, edges, violations } = this.verifyTopologyConstraints(rawStructure);

    // Step 4: Generate embeddings
    if (this.options.embed) {
      for (const node of nodes) {
        if (!node.embedding) {
          node.embedding = await this.options.embed(node.content);
        }
      }
    }

    // Calculate metrics
    const topology = this.calculateTopologyMetrics(nodes, edges, violations);
    const extractionRatio = (nodes.length / analysis.wordCount) * 100;

    return {
      nodes,
      edges,
      topology,
      analysis: {
        textComplexity: analysis.complexity,
        conceptDensity: analysis.conceptDensity,
        extractionRatio,
        technicalTerms: analysis.technicalTerms.length,
        relationships: analysis.relationships.length,
      },
    };
  }

  /**
   * Analyze text to determine extraction strategy
   */
  private analyzeText(text: string): TextAnalysis {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

    // Detect technical terms (capitalized words, acronyms, technical patterns)
    const technicalTerms = this.detectTechnicalTerms(text);

    // Extract entities (proper nouns, specific concepts)
    const entities = this.extractEntities(text);

    // Extract concepts (key ideas, themes)
    const concepts = this.extractConcepts(text, words);

    // Detect relationships (subject-verb-object patterns)
    const relationships = this.detectRelationships(sentences);

    // Calculate complexity (0-1 scale)
    const complexity = this.calculateComplexity({
      avgWordLength: words.reduce((sum, w) => sum + w.length, 0) / words.length,
      avgSentenceLength: words.length / sentences.length,
      technicalTermRatio: technicalTerms.length / words.length,
      uniqueWordRatio: new Set(words.map(w => w.toLowerCase())).size / words.length,
    });

    // Calculate concept density (concepts per 100 words)
    const conceptDensity = (concepts.length / words.length) * 100;

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,
      technicalTerms,
      entities,
      concepts,
      relationships,
      complexity,
      conceptDensity,
    };
  }

  /**
   * Detect technical terms in text
   */
  private detectTechnicalTerms(text: string): string[] {
    const terms: string[] = [];
    
    // Capitalized words (potential technical terms)
    const capitalizedPattern = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g;
    const capitalized = text.match(capitalizedPattern) || [];
    terms.push(...capitalized);

    // Acronyms (2+ capital letters)
    const acronymPattern = /\b[A-Z]{2,}\b/g;
    const acronyms = text.match(acronymPattern) || [];
    terms.push(...acronyms);

    // Technical patterns (camelCase, snake_case, kebab-case)
    const technicalPattern = /\b[a-z]+[A-Z][a-zA-Z]*\b|\b[a-z]+_[a-z]+\b|\b[a-z]+-[a-z]+\b/g;
    const technical = text.match(technicalPattern) || [];
    terms.push(...technical);

    return [...new Set(terms)];
  }

  /**
   * Extract entities (proper nouns, specific concepts)
   */
  private extractEntities(text: string): string[] {
    // Simple entity extraction: capitalized phrases
    const entityPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const entities = text.match(entityPattern) || [];
    return [...new Set(entities)];
  }

  /**
   * Extract key concepts from text
   */
  private extractConcepts(text: string, words: string[]): string[] {
    const concepts: string[] = [];
    
    // Multi-word concepts (noun phrases)
    const nounPhrasePattern = /\b(?:the\s+)?[a-z]+(?:\s+[a-z]+){1,3}\b/gi;
    const phrases = text.match(nounPhrasePattern) || [];
    
    // Filter for meaningful concepts (length > 2 words or technical terms)
    concepts.push(...phrases.filter(p => p.split(/\s+/).length >= 2 || /[A-Z]/.test(p)));

    // Single important words (longer than 6 chars, not common words)
    const commonWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'been', 'will', 'would', 'could', 'should']);
    const importantWords = words.filter(w => w.length > 6 && !commonWords.has(w.toLowerCase()));
    concepts.push(...importantWords);

    return [...new Set(concepts)];
  }

  /**
   * Detect relationships in sentences
   */
  private detectRelationships(sentences: string[]): Array<{ subject: string; predicate: string; object: string }> {
    const relationships: Array<{ subject: string; predicate: string; object: string }> = [];
    
    // Simple SVO pattern detection
    const svoPattern = /^([A-Z][a-z]+(?:\s+[a-z]+)?)\s+(is|are|has|have|does|do|can|will|should|must)\s+(.+)$/i;
    
    for (const sentence of sentences) {
      const match = sentence.trim().match(svoPattern);
      if (match && match[1] && match[2] && match[3]) {
        relationships.push({
          subject: match[1],
          predicate: match[2],
          object: match[3].replace(/[.!?]$/, ''),
        });
      }
    }

    return relationships;
  }

  /**
   * Calculate text complexity (0-1 scale)
   */
  private calculateComplexity(metrics: {
    avgWordLength: number;
    avgSentenceLength: number;
    technicalTermRatio: number;
    uniqueWordRatio: number;
  }): number {
    // Normalize each metric to 0-1 scale
    const wordLengthScore = Math.min(metrics.avgWordLength / 10, 1);
    const sentenceLengthScore = Math.min(metrics.avgSentenceLength / 30, 1);
    const technicalScore = Math.min(metrics.technicalTermRatio * 10, 1);
    const uniquenessScore = metrics.uniqueWordRatio;

    // Weighted average
    return (
      wordLengthScore * 0.2 +
      sentenceLengthScore * 0.2 +
      technicalScore * 0.4 +
      uniquenessScore * 0.2
    );
  }

  /**
   * Extract atomic structure based on content analysis
   */
  private async extractAtomicStructure(
    text: string,
    analysis: TextAnalysis
  ): Promise<{ nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] }> {
    const prompt = this.buildAtomicPrompt(text, analysis);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await this.options.generate(prompt, {
          maxTokens: 4096,
          schema: this.buildDynamicSchema(analysis),
        });

        const result = this.parseAtomicResponse(raw);
        
        // Validate that we extracted meaningful content
        if (result.nodes.length > 0) {
          return this.enrichWithMetadata(result);
        }
      } catch (e) {
        // Continue to next attempt
      }
    }

    // Fallback: heuristic extraction
    return this.heuristicAtomicExtract(text, analysis);
  }

  /**
   * Build atomic extraction prompt (no fixed node count)
   */
  private buildAtomicPrompt(text: string, analysis: TextAnalysis): string {
    const granularityGuidance: Record<string, string> = {
      atomic: 'Extract EVERY atomic concept, attribute, operation, and relationship. Be extremely detailed and granular.',
      balanced: 'Extract key concepts, important attributes, and major relationships. Balance detail with clarity.',
      sparse: 'Extract only the most important high-level concepts and critical relationships.',
    };

    const guidance = granularityGuidance[this.granularity] || granularityGuidance['balanced'];

    return `You are an atomic knowledge extraction engine. Analyze the following text and extract its fundamental knowledge atoms.

TEXT ANALYSIS:
- Complexity: ${(analysis.complexity * 100).toFixed(0)}% (${analysis.complexity > 0.7 ? 'high' : analysis.complexity > 0.4 ? 'medium' : 'low'})
- Concept Density: ${analysis.conceptDensity.toFixed(1)} concepts per 100 words
- Technical Terms: ${analysis.technicalTerms.length}
- Detected Entities: ${analysis.entities.length}
- Relationships: ${analysis.relationships.length}

EXTRACTION STRATEGY: ${this.granularity.toUpperCase()}
${guidance}

EXTRACT THE FOLLOWING ATOMIC TYPES:

1. **Core Concepts** - Main ideas, paradigms, frameworks
   - Extract: ${analysis.concepts.slice(0, 10).join(', ')}...

2. **Attributes** - Properties, characteristics, states, data types
   - Look for: descriptive properties, qualifiers, specifications

3. **Operations** - Actions, functions, transformations, processes
   - Look for: verbs, methods, procedures, algorithms

4. **Contextual Modifiers** - Constraints, conditions, environments, metadata
   - Look for: when, where, why, under what conditions

5. **Relationships** - How concepts connect
   - Detected: ${analysis.relationships.map(r => `${r.subject} ${r.predicate} ${r.object}`).slice(0, 3).join('; ')}

TOPOLOGY RULES:
- Create a deep hierarchy with at least ${this.minDepthTiers} vertical tiers
- NO node should have more than ${this.maxEdgesPerNode} outgoing edges
- Use edge types: PARENT_OF (hierarchy), DEPENDS_ON (dependency), MODIFIES (transformation), RESONATES_WITH (similarity)

TEXT TO EXTRACT:
${text}

Return a JSON object with ALL atomic knowledge units you can identify:
{
  "nodes": [
    {
      "id": "unique-id",
      "label": "Short Label (1-5 words)",
      "type": "Concept|Attribute|Operation|ContextModifier|CoreTopic|GranularAttribute|ExecutionState",
      "content": "Detailed atomic content",
      "depthLevel": 0,
      "confidence": 0.95
    }
  ],
  "edges": [
    {
      "sourceNodeId": "parent-id",
      "targetNodeId": "child-id",
      "relationshipType": "PARENT_OF|DEPENDS_ON|MODIFIES|RESONATES_WITH",
      "weight": 0.9
    }
  ]
}`;
  }

  /**
   * Build dynamic schema based on analysis
   */
  private buildDynamicSchema(analysis: TextAnalysis): Record<string, unknown> {
    // Estimate node count based on content analysis
    const estimatedNodes = Math.ceil(
      analysis.concepts.length * 1.5 + // Each concept might spawn 1-2 nodes
      analysis.entities.length +
      analysis.relationships.length * 2 + // Each relationship creates 2-3 nodes
      analysis.technicalTerms.length * 0.5
    );

    return {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          minItems: Math.max(1, Math.floor(estimatedNodes * 0.5)),
          maxItems: estimatedNodes * 3,
          items: {
            type: 'object',
            required: ['label', 'type', 'content', 'depthLevel'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string', maxLength: 20 },
              type: {
                type: 'string',
                enum: ['Session', 'CoreTopic', 'Concept', 'Attribute', 'Operation', 'ContextModifier', 'SubContext', 'GranularAttribute', 'ExecutionState'],
              },
              content: { type: 'string', maxLength: 500 },
              depthLevel: { type: 'integer', minimum: 0, maximum: 10 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sourceNodeId', 'targetNodeId', 'relationshipType'],
            properties: {
              sourceNodeId: { type: 'string' },
              targetNodeId: { type: 'string' },
              relationshipType: {
                type: 'string',
                enum: ['PARENT_OF', 'DEPENDS_ON', 'MODIFIES', 'RESONATES_WITH'],
              },
              weight: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
      required: ['nodes', 'edges'],
    };
  }

  /**
   * Parse atomic response
   */
  private parseAtomicResponse(raw: string): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] } {
    const json = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json);

    const nodes: MemoryNodeInput[] = parsed.nodes.map((n: any) => ({
      id: n.id ?? crypto.randomUUID(),
      label: n.label,
      category: this.mapTypeToCategory(n.type),
      content: n.content,
      confidence: n.confidence ?? 0.8,
      sessionId: this.options.clusterId,
      sourceId: this.options.sourceId ?? undefined,
    }));

    const edges: MemoryEdgeInput[] = parsed.edges.map((e: any) => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      relationshipType: e.relationshipType as MemoryEdgeType,
      weight: e.weight ?? 0.8,
    }));

    return { nodes, edges };
  }

  private mapTypeToCategory(type: string): 'persona' | 'tool' | 'episodic' | 'semantic' | 'source_doc' | 'system' {
    switch (type) {
      case 'Session':
        return 'episodic';
      case 'CoreTopic':
      case 'Concept':
      case 'Attribute':
      case 'GranularAttribute':
        return 'semantic';
      case 'Operation':
        return 'tool';
      case 'ContextModifier':
      case 'SubContext':
      case 'ExecutionState':
        return 'system';
      default:
        return 'semantic';
    }
  }

  private enrichWithMetadata(result: { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] }): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] } {
    const idMap = new Map<string, string>();
    
    result.nodes.forEach(node => {
      const oldId = node.id;
      if (!node.id) {
        node.id = crypto.randomUUID();
      }
      if (oldId && oldId !== node.id) {
        idMap.set(oldId, node.id);
      }
      
      node.sessionId = this.options.clusterId;
      if (this.options.sourceId) {
        node.sourceId = this.options.sourceId;
      }
    });

    result.edges.forEach(edge => {
      const newSourceId = idMap.get(edge.sourceNodeId);
      if (newSourceId) {
        edge.sourceNodeId = newSourceId;
      }
      const newTargetId = idMap.get(edge.targetNodeId);
      if (newTargetId) {
        edge.targetNodeId = newTargetId;
      }
    });

    return result;
  }

  /**
   * Enforce topology constraints: anti-centralization (max edges per node) by
   * spawning Sub-Context relay nodes, plus minimum-depth verification.
   */
  private verifyTopologyConstraints(
    input: { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] }
  ): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[]; violations: string[] } {
    const { nodes, edges } = input;
    const violations: string[] = [];
    const newNodes: MemoryNodeInput[] = [...nodes];
    const newEdges: MemoryEdgeInput[] = [];

    // Count outgoing edges per node
    const outgoingEdgeCount = new Map<string, number>();
    const nodeEdges = new Map<string, MemoryEdgeInput[]>();

    edges.forEach(edge => {
      outgoingEdgeCount.set(edge.sourceNodeId, (outgoingEdgeCount.get(edge.sourceNodeId) ?? 0) + 1);
      const edgeList = nodeEdges.get(edge.sourceNodeId) ?? [];
      edgeList.push(edge);
      nodeEdges.set(edge.sourceNodeId, edgeList);
    });

    // Fix nodes that exceed max edges by spawning Sub-Context relay nodes
    outgoingEdgeCount.forEach((count, nodeId) => {
      const edgeList = nodeEdges.get(nodeId) ?? [];

      if (count <= this.maxEdgesPerNode) {
        newEdges.push(...edgeList);
        return;
      }

      violations.push(`Node ${nodeId} has ${count} edges, exceeds max ${this.maxEdgesPerNode}`);

      const originalNode = nodes.find(n => n.id === nodeId);
      if (!originalNode) {
        newEdges.push(...edgeList);
        return;
      }

      // Keep first (max-1) edges direct, reserve one slot for the relay node
      const directEdges = edgeList.slice(0, this.maxEdgesPerNode - 1);
      const overflowEdges = edgeList.slice(this.maxEdgesPerNode - 1);

      const subContextNode: MemoryNodeInput = {
        id: crypto.randomUUID(),
        label: `${originalNode.label}_ext`.slice(0, 20),
        category: 'system',
        content: `Extension context for ${originalNode.label}`,
        sessionId: this.options.clusterId,
        sourceId: this.options.sourceId ?? undefined,
      };
      newNodes.push(subContextNode);

      newEdges.push({
        sourceNodeId: nodeId,
        targetNodeId: subContextNode.id!,
        relationshipType: 'PARENT_OF',
        weight: 1.0,
      });
      newEdges.push(...directEdges);
      overflowEdges.forEach(edge => {
        newEdges.push({
          sourceNodeId: subContextNode.id!,
          targetNodeId: edge.targetNodeId,
          relationshipType: edge.relationshipType,
          weight: edge.weight,
        });
      });
    });

    // Verify minimum depth
    const depths = this.calculateDepths(newNodes, newEdges);
    const maxDepth = Math.max(...Array.from(depths.values()), 0);
    if (maxDepth < this.minDepthTiers) {
      violations.push(`Max depth ${maxDepth} < minimum ${this.minDepthTiers}`);
    }

    return { nodes: newNodes, edges: newEdges, violations };
  }

  /**
   * Calculate node depths via BFS along PARENT_OF edges from root nodes.
   */
  private calculateDepths(nodes: MemoryNodeInput[], edges: MemoryEdgeInput[]): Map<string, number> {
    const depths = new Map<string, number>();
    const childrenMap = new Map<string, string[]>();

    edges.forEach(edge => {
      if (edge.relationshipType === 'PARENT_OF') {
        const children = childrenMap.get(edge.sourceNodeId) ?? [];
        children.push(edge.targetNodeId);
        childrenMap.set(edge.sourceNodeId, children);
      }
    });

    const hasParent = new Set(
      edges.filter(e => e.relationshipType === 'PARENT_OF').map(e => e.targetNodeId)
    );
    const roots = nodes.filter(n => n.id && !hasParent.has(n.id)).map(n => n.id!);

    const queue: Array<{ id: string; depth: number }> = roots.map(id => ({ id, depth: 0 }));
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      depths.set(id, depth);

      const children = childrenMap.get(id) ?? [];
      children.forEach(childId => {
        if (!visited.has(childId)) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      });
    }

    nodes.forEach(n => {
      if (n.id && !depths.has(n.id)) depths.set(n.id, 0);
    });

    return depths;
  }

  private calculateTopologyMetrics(
    nodes: MemoryNodeInput[],
    edges: MemoryEdgeInput[],
    violations: string[]
  ): AtomicResult['topology'] {
    const depths = this.calculateDepths(nodes, edges);
    const maxDepth = Math.max(...Array.from(depths.values()), 0);

    const outgoingEdgeCount = new Map<string, number>();
    edges.forEach(edge => {
      outgoingEdgeCount.set(edge.sourceNodeId, (outgoingEdgeCount.get(edge.sourceNodeId) ?? 0) + 1);
    });

    const edgeCounts = Array.from(outgoingEdgeCount.values());
    const avgEdgesPerNode = edgeCounts.length > 0
      ? edgeCounts.reduce((a, b) => a + b, 0) / edgeCounts.length
      : 0;
    const maxEdgesPerNode = Math.max(...edgeCounts, 0);

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      maxDepth,
      avgEdgesPerNode,
      maxEdgesPerNode,
      violatesConstraints: violations.length > 0,
      violations,
    };
  }

  private heuristicAtomicExtract(
    text: string,
    analysis: TextAnalysis
  ): { nodes: MemoryNodeInput[]; edges: MemoryEdgeInput[] } {
    const nodes: MemoryNodeInput[] = [];
    const edges: MemoryEdgeInput[] = [];

    // Create session root
    const sessionNode: MemoryNodeInput = {
      id: crypto.randomUUID(),
      label: 'Session',
      category: 'episodic',
      content: text.slice(0, 200),
      sessionId: this.options.clusterId,
      sourceId: this.options.sourceId,
    };
    nodes.push(sessionNode);

    // Extract concepts as nodes
    analysis.concepts.forEach(concept => {
      const conceptNode: MemoryNodeInput = {
        id: crypto.randomUUID(),
        label: concept.slice(0, 20),
        category: 'semantic',
        content: concept,
        sessionId: this.options.clusterId,
        sourceId: this.options.sourceId,
      };
      nodes.push(conceptNode);

      edges.push({
        sourceNodeId: sessionNode.id!,
        targetNodeId: conceptNode.id!,
        relationshipType: 'PARENT_OF',
        weight: 0.7,
      });
    });

    // Extract entities as nodes
    analysis.entities.forEach(entity => {
      const entityNode: MemoryNodeInput = {
        id: crypto.randomUUID(),
        label: entity.slice(0, 20),
        category: 'semantic',
        content: entity,
        sessionId: this.options.clusterId,
        sourceId: this.options.sourceId,
      };
      nodes.push(entityNode);

      edges.push({
        sourceNodeId: sessionNode.id!,
        targetNodeId: entityNode.id!,
        relationshipType: 'PARENT_OF',
        weight: 0.8,
      });
    });

    return { nodes, edges };
  }
}
