/**
 * Local LLM judge for RAG-Triad evaluation.
 *
 * Runs a small instruction-tuned model locally via Transformers.js so the entire
 * benchmark pipeline can operate offline. The judge produces structured scores
 * for Context Relevance, Groundedness, and Mean Reciprocal Rank (MRR).
 */
import { pipeline, type TextGenerationPipeline } from '@xenova/transformers';

export interface RagTriadScores {
  contextRelevance: number;
  groundedness: number;
  mrr: number;
}

export interface LocalLLMJudgeOptions {
  modelName?: string;
  maxNewTokens?: number;
  temperature?: number;
}

export class LocalLLMJudge {
  private pipe: TextGenerationPipeline | null = null;
  private pending: Promise<TextGenerationPipeline> | null = null;

  constructor(private options: LocalLLMJudgeOptions = {}) {}

  async evaluateRagTriad(query: string, context: string, answer?: string): Promise<RagTriadScores> {
    const [contextRelevance, groundedness, mrr] = await Promise.all([
      this.scoreContextRelevance(query, context),
      answer ? this.scoreGroundedness(context, answer) : Promise.resolve(0.5),
      this.scoreMrr(query, context),
    ]);
    return { contextRelevance, groundedness, mrr };
  }

  private async scoreContextRelevance(query: string, context: string): Promise<number> {
    const prompt = `You are an evaluator. Rate how relevant the following context is to answering the query.
Query: ${query}
Context: ${context.slice(0, 800)}

Return only a number from 0 to 1, where 1 means highly relevant and 0 means irrelevant. Answer with just the number.`;
    return this.extractScore(await this.generate(prompt));
  }

  private async scoreGroundedness(context: string, answer: string): Promise<number> {
    const prompt = `You are an evaluator. Rate how well the answer is grounded in the provided context.
Context: ${context.slice(0, 800)}
Answer: ${answer.slice(0, 400)}

Return only a number from 0 to 1, where 1 means fully supported by the context and 0 means unsupported. Answer with just the number.`;
    return this.extractScore(await this.generate(prompt));
  }

  private async scoreMrr(query: string, context: string): Promise<number> {
    // Treat the provided context as the top-ranked retrieved document and judge whether it answers the query.
    const prompt = `You are an evaluator. The top-ranked retrieved document is below. If it answers the query, score 1.0. If it is partially useful, score 0.5. If it does not help, score 0.0.
Query: ${query}
Document: ${context.slice(0, 800)}

Return only a number: 0, 0.5, or 1.0. Answer with just the number.`;
    return this.extractScore(await this.generate(prompt));
  }

  async generate(prompt: string, options?: { maxTokens?: number }): Promise<string> {
    const pipe = await this.load();
    const result = await pipe(prompt, {
      max_new_tokens: options?.maxTokens ?? this.options.maxNewTokens ?? 10,
      temperature: this.options.temperature ?? 0.1,
      do_sample: false,
      return_full_text: false,
    });
    const text = Array.isArray(result)
      ? (result[0] as { generated_text?: string }).generated_text
      : (result as { generated_text?: string }).generated_text;
    return (text ?? '').trim();
  }

  private extractScore(text: string | undefined): number {
    if (!text) return 0.5;
    const match = text.match(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/);
    if (!match) return 0.5;
    const value = parseFloat(match[1] ?? '0.5');
    if (Number.isNaN(value)) return 0.5;
    return Math.max(0, Math.min(1, value));
  }

  private async load(): Promise<TextGenerationPipeline> {
    if (this.pipe) return this.pipe;
    if (this.pending) return this.pending;
    const modelName = this.options.modelName ?? 'Xenova/Qwen2.5-0.5B-Instruct';
    this.pending = pipeline('text-generation', modelName, {
      quantized: true,
      revision: 'main',
    }) as Promise<TextGenerationPipeline>;
    this.pipe = await this.pending;
    this.pending = null;
    return this.pipe;
  }
}
