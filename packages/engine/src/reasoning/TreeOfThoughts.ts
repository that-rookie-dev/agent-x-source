import type { ProviderInterface } from '../providers/ProviderInterface.js';
import type { EngineEvent } from '@agentx/shared';
import { generateId } from '@agentx/shared';

export interface ThoughtNode {
  id: string;
  content: string;
  score: number;
  parentId?: string;
  children: string[];
  depth: number;
}

export interface TreeOfThoughtsOptions {
  provider: ProviderInterface;
  model: string;
  emit: (event: EngineEvent) => void;
}

export class TreeOfThoughts {
  private provider: ProviderInterface;
  private model: string;
  private emit: (event: EngineEvent) => void;

  constructor(options: TreeOfThoughtsOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.emit = options.emit;
  }

  private async completeText(prompt: string, maxTokens = 1000): Promise<string> {
    let result = '';
    const stream = this.provider.complete({
      messages: [{ role: 'user', content: prompt }],
      model: this.model,
      maxTokens,
      stream: true,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta' && chunk.content) {
        result += chunk.content;
      }
    }
    return result.trim();
  }

  async generateThoughts(problem: string, count: number): Promise<ThoughtNode[]> {
    const prompt = `You are an expert reasoning assistant. Given the following problem, generate ${count} distinct initial reasoning paths or approaches to solve it.

Problem: "${problem}"

For each reasoning path, provide a clear, concise description of the approach. Number each path.

Format:
1. [First reasoning path description]
2. [Second reasoning path description]
...`;

    const response = await this.completeText(prompt, Math.min(count * 300, 2000));
    const thoughts: ThoughtNode[] = [];
    const lines = response.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\d+)[.)]\s*(.+)/);
      if (match) {
        const content = match[2]!.trim();
        if (content.length > 10) {
          thoughts.push({
            id: generateId('thought'),
            content,
            score: 0,
            children: [],
            depth: 0,
          });
        }
      }
    }

    // If parsing failed, fall back to splitting by double newlines
    if (thoughts.length === 0) {
      const blocks = response.split(/\n\s*\n/).filter((b) => b.trim().length > 10);
      for (const block of blocks.slice(0, count)) {
        thoughts.push({
          id: generateId('thought'),
          content: block.trim(),
          score: 0,
          children: [],
          depth: 0,
        });
      }
    }

    return thoughts.slice(0, count);
  }

  async evaluateThoughts(thoughts: ThoughtNode[]): Promise<ThoughtNode[]> {
    const evaluated = await Promise.all(
      thoughts.map(async (thought) => {
        const prompt = `Rate this reasoning path from 0-10 based on correctness, completeness, and practicality.

Reasoning path: "${thought.content}"

Respond with ONLY a number from 0 to 10.`;

        const response = await this.completeText(prompt, 50);
        const scoreMatch = response.match(/\b(\d+(?:\.\d+)?)\b/);
        const rawScore = scoreMatch ? parseFloat(scoreMatch[1]!) : 5;
        const normalizedScore = Math.max(0, Math.min(1, rawScore / 10));

        return {
          ...thought,
          score: normalizedScore,
        };
      }),
    );

    return evaluated.sort((a, b) => b.score - a.score);
  }

  async expandThought(node: ThoughtNode, count: number): Promise<ThoughtNode[]> {
    const prompt = `You are an expert reasoning assistant. Given the following reasoning path, expand it into ${count} more detailed child reasoning steps or sub-approaches.

Parent reasoning path: "${node.content}"

Generate ${count} distinct next steps or refinements. Number each step.

Format:
1. [First child reasoning step]
2. [Second child reasoning step]
...`;

    const response = await this.completeText(prompt, Math.min(count * 300, 2000));
    const children: ThoughtNode[] = [];
    const lines = response.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\d+)[.)]\s*(.+)/);
      if (match) {
        const content = match[2]!.trim();
        if (content.length > 10) {
          const child: ThoughtNode = {
            id: generateId('thought'),
            content,
            score: 0,
            parentId: node.id,
            children: [],
            depth: node.depth + 1,
          };
          children.push(child);
          node.children.push(child.id);
        }
      }
    }

    if (children.length === 0) {
      const blocks = response.split(/\n\s*\n/).filter((b) => b.trim().length > 10);
      for (const block of blocks.slice(0, count)) {
        const child: ThoughtNode = {
          id: generateId('thought'),
          content: block.trim(),
          score: 0,
          parentId: node.id,
          children: [],
          depth: node.depth + 1,
        };
        children.push(child);
        node.children.push(child.id);
      }
    }

    return children.slice(0, count);
  }

  async solve(
    problem: string,
    options?: { maxDepth?: number; beamWidth?: number; thoughtsPerNode?: number },
  ): Promise<ThoughtNode> {
    const maxDepth = options?.maxDepth ?? 3;
    const beamWidth = options?.beamWidth ?? 3;
    const thoughtsPerNode = options?.thoughtsPerNode ?? 3;

    this.emit({ type: 'tot_start', problem });

    let currentLevel = await this.generateThoughts(problem, beamWidth);

    for (const thought of currentLevel) {
      this.emit({ type: 'tot_thought_generated', thoughtId: thought.id, content: thought.content, depth: thought.depth });
    }

    currentLevel = await this.evaluateThoughts(currentLevel);

    for (const thought of currentLevel) {
      this.emit({ type: 'tot_evaluation', thoughtId: thought.id, score: thought.score });
    }

    for (let depth = 0; depth < maxDepth; depth++) {
      const topNodes = currentLevel.slice(0, beamWidth);
      const nextLevel: ThoughtNode[] = [];

      for (const node of topNodes) {
        const children = await this.expandThought(node, thoughtsPerNode);
        for (const child of children) {
          this.emit({ type: 'tot_thought_generated', thoughtId: child.id, content: child.content, parentId: child.parentId, depth: child.depth });
          nextLevel.push(child);
        }
      }

      if (nextLevel.length === 0) break;

      const evaluated = await this.evaluateThoughts(nextLevel);
      for (const thought of evaluated) {
        this.emit({ type: 'tot_evaluation', thoughtId: thought.id, score: thought.score });
      }

      currentLevel = evaluated.slice(0, beamWidth);
    }

    const best = currentLevel[0]!;
    this.emit({ type: 'tot_complete', bestThoughtId: best.id, score: best.score, content: best.content });
    return best;
  }
}
