import type { Agent } from '../agent/Agent.js';
import { SmartSubAgent } from '../agent/SmartSubAgent.js';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import type { EngineEvent } from '@agentx/shared';
import { generateId } from '@agentx/shared';

export interface ResearchQuery {
  id: string;
  question: string;
  sources: 'web' | 'code' | 'docs' | 'all';
}

export interface ResearchResult {
  queryId: string;
  question: string;
  answer: string;
  sources: string[];
  elapsed: number;
}

export interface ResearchEngineOptions {
  provider: ProviderInterface;
  model: string;
  emit: (event: EngineEvent) => void;
}

export class ResearchEngine {
  private provider: ProviderInterface;
  private model: string;
  private emit: (event: EngineEvent) => void;

  constructor(options: ResearchEngineOptions) {
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

  async decomposeQuery(question: string): Promise<ResearchQuery[]> {
    const prompt = `You are a research assistant. Break down the following research question into 2-5 focused sub-queries that can be investigated in parallel.

Research question: "${question}"

For each sub-query, specify:
- The specific question to investigate
- The primary source type: "web" (general web search), "code" (codebase search), "docs" (documentation), or "all" (any source)

Return ONLY a JSON array in this format:
[
  { "question": "...", "sources": "web" },
  ...
]

Sources must be one of: "web", "code", "docs", "all".`;

    const response = await this.completeText(prompt, 1500);
    const jsonStart = response.indexOf('[');
    const jsonEnd = response.lastIndexOf(']');

    if (jsonStart !== -1 && jsonEnd !== -1) {
      try {
        const parsed = JSON.parse(response.slice(jsonStart, jsonEnd + 1)) as Array<{ question: string; sources: string }>;
        return parsed.map((p) => ({
          id: generateId('query'),
          question: p.question,
          sources: ['web', 'code', 'docs', 'all'].includes(p.sources) ? (p.sources as ResearchQuery['sources']) : 'all',
        }));
      } catch {
        // Fall through to heuristic
      }
    }

    // Fallback: split by numbered lines
    const queries: ResearchQuery[] = [];
    const lines = response.split('\n');
    for (const line of lines) {
      const match = line.match(/^\d+[.)]\s*(.+)/);
      if (match) {
        queries.push({
          id: generateId('query'),
          question: match[1]!.trim(),
          sources: 'all',
        });
      }
    }

    return queries.length > 0 ? queries : [{ id: generateId('query'), question, sources: 'all' }];
  }

  async executeParallel(queries: ResearchQuery[], agent: Agent): Promise<ResearchResult[]> {
    const toolMap: Record<ResearchQuery['sources'], string[]> = {
      web: ['deep_web_search', 'web_search', 'web_scrape'],
      code: ['code_search', 'file_read'],
      docs: ['deep_web_search', 'web_search', 'file_read'],
      all: ['deep_web_search', 'web_search', 'web_scrape', 'code_search', 'file_read'],
    };

    const results = await Promise.all(
      queries.map(async (query) => {
        const start = Date.now();
        this.emit({ type: 'research_query', queryId: query.id, question: query.question, sources: query.sources });

        const run = async () => {
          const subAgent = new SmartSubAgent({
            parentAgent: agent,
            instruction: `Research this specific question thoroughly and return a concise but comprehensive summary with sources:\n\n${query.question}`,
            tools: toolMap[query.sources] ?? toolMap.all,
            timeout: 120_000,
          });
          return subAgent.execute();
        };

        // Share Agent-X virtual concurrency pool (queue when at capacity)
        const subResult = agent.agents
          ? await agent.agents.runInPool(run)
          : await run();
        const elapsed = Date.now() - start;

        const result: ResearchResult = {
          queryId: query.id,
          question: query.question,
          answer: subResult.output,
          sources: subResult.toolCalls.map((tc) => tc.name),
          elapsed,
        };

        this.emit({ type: 'research_subagent_complete', queryId: query.id, result });
        return result;
      }),
    );

    return results;
  }

  async synthesize(results: ResearchResult[], agent: Agent): Promise<string> {
    this.emit({ type: 'research_synthesis', resultCount: results.length });

    const synthesisPrompt = `You are a research synthesis expert. Combine the following research results into a single coherent, well-structured report.

${results.map((r, i) => `## Result ${i + 1}: ${r.question}\n${r.answer}\nSources used: ${r.sources.join(', ') || 'none'}\n`).join('\n')}

Provide a comprehensive report that:
1. Integrates all findings into a cohesive narrative
2. Resolves any contradictions between sources
3. Highlights key insights and conclusions
4. Maintains factual accuracy
5. Is well-structured with clear sections`;

    const agentProvider = (agent as unknown as { provider?: ProviderInterface }).provider;
    const agentModel = (agent as unknown as { config?: { provider?: { activeModel?: string } } }).config?.provider?.activeModel ?? this.model;

    let output = '';
    if (agentProvider) {
      const stream = agentProvider.complete({
        messages: [{ role: 'user', content: synthesisPrompt }],
        model: agentModel,
        maxTokens: 4000,
        stream: true,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text_delta' && chunk.content) {
          output += chunk.content;
        }
      }
    } else {
      output = await this.completeText(synthesisPrompt, 4000);
    }

    return output.trim();
  }

  async research(question: string, agent: Agent): Promise<string> {
    this.emit({ type: 'research_start', question });

    const queries = await this.decomposeQuery(question);
    const results = await this.executeParallel(queries, agent);
    const report = await this.synthesize(results, agent);

    this.emit({ type: 'research_complete', report });
    return report;
  }
}
