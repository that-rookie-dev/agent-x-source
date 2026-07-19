/**
 * Ingestion worker that processes jobs from the `ingestion_jobs` queue.
 *
 * The worker is designed to run in the main process or in a Node.js worker
 * thread. It claims jobs with `FOR UPDATE SKIP LOCKED`, executes the
 * appropriate handler, and reports progress/completion.
 */
import type { Pool } from 'pg';
import { IngestionQueue, type ClaimedJob, type JobKind } from './IngestionQueue.js';
import type { MemoryFabric } from './MemoryFabric.js';
import { MemoryPipeline } from './MemoryPipeline.js';
import { MemoryConsolidator } from './MemoryConsolidator.js';
import { DocumentIngester } from './DocumentIngester.js';
import { OnnxEmbeddingProvider } from './OnnxEmbeddingProvider.js';
import { LocalLLMJudge } from './LocalLLMJudge.js';
import { CommunitySummarizer } from './CommunitySummarizer.js';
import type { GenerateFn } from './MemoryExtractor.js';
import type { EmbeddingProvider } from '@agentx/shared';

export interface IngestionWorkerOptions {
  /** Kinds to process. Defaults to all. */
  kinds?: JobKind[];
  /** Max concurrent jobs. */
  concurrency?: number;
  /** Poll interval in ms. */
  pollIntervalMs?: number;
  /** Embedding provider. */
  embed?: (text: string) => Promise<number[]>;
  /** LLM generate function for community summarization (GraphRAG). */
  generate?: GenerateFn | null;
  /** Full embedding provider for community summarization (needs embedBatch). */
  embedder?: EmbeddingProvider | null;
}

export class IngestionWorker {
  private queue: IngestionQueue;
  private running = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = 0;
  private embed: (text: string) => Promise<number[]>;
  private generate: GenerateFn | null;
  private embedder: EmbeddingProvider | null;
  /** Set of job IDs that have been cancelled by the user. The worker checks
   *  this set before processing each chunk and aborts gracefully if present. */
  private cancelledJobIds = new Set<string>();

  /** Update the LLM generator after construction (e.g. after user login). */
  setGenerate(fn: GenerateFn | null): void {
    this.generate = fn;
  }

  /** Check whether an LLM generator is currently available. */
  hasGenerate(): boolean {
    return this.generate != null;
  }

  /** Request cancellation of a running job. The worker checks this before each
   *  chunk and aborts gracefully. Also marks the job as cancelled in the DB. */
  async cancelJob(jobId: string): Promise<boolean> {
    this.cancelledJobIds.add(jobId);
    try {
      return await this.queue.cancelJob(jobId);
    } catch {
      return false;
    }
  }

  constructor(
    private pool: Pool,
    private fabric: MemoryFabric,
    private options: IngestionWorkerOptions = {},
  ) {
    this.queue = new IngestionQueue(pool);
    this.embed = options.embed ?? (async (text) => {
      const provider = new OnnxEmbeddingProvider();
      return provider.embed(text);
    });
    this.generate = options.generate ?? null;
    this.embedder = options.embedder ?? null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.scheduleNext();
  }

  /** Pause polling — in-flight jobs may finish; no new ticks until resume(). */
  pause(): void {
    this.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  resume(): void {
    if (!this.running) {
      this.start();
      return;
    }
    if (!this.paused) return;
    this.paused = false;
    this.scheduleNext();
  }

  isPaused(): boolean {
    return this.paused;
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running || this.paused) return;
    const pollIntervalMs = this.options.pollIntervalMs ?? 5000;
    this.timer = setTimeout(() => {
      void this.tick();
    }, pollIntervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.paused) return;
    const concurrency = this.options.concurrency ?? 1;
    const kinds = this.options.kinds ?? ['web_distill', 're_extract', 'memory_consolidate', 'louvain_layout', 'community_summarize'];
    const limit = Math.max(1, concurrency - this.active);

    try {
      const jobs = await this.queue.claimNext(kinds, limit);
      if (jobs.length > 0) {
        for (const job of jobs) {
          this.active++;
          void this.runJob(job).finally(() => {
            this.active--;
          });
        }
      }
    } catch (e) {
      console.error('IngestionWorker tick failed:', e instanceof Error ? e.message : e);
    }

    this.scheduleNext();
  }

  private async runJob(claimed: ClaimedJob): Promise<void> {
    const { job } = claimed;
    try {
      const result = await this.handleJob(claimed);
      // If the job was cancelled, don't mark it as done — the cancelJob()
      // method already set the status to 'cancelled' in the DB.
      if (result && typeof result === 'object' && 'cancelled' in result && result.cancelled) {
        return; // leave status as 'cancelled'
      }
      await claimed.complete(result ?? { ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await claimed.fail(message, job.attemptCount + 1 < job.maxAttempts);
    }
  }

  private async handleJob(claimed: ClaimedJob): Promise<Record<string, unknown> | void> {
    const { job } = claimed;
    switch (job.kind) {
      case 'web_distill': {
        const pipeline = new MemoryPipeline(this.fabric, {
          consolidator: new MemoryConsolidator(this.fabric),
          ingester: new DocumentIngester(this.fabric),
          domainCluster: true,
          embed: this.embed,
        });
        await pipeline.run();
        return;
      }
      case 're_extract': {
        // Re-run entity extraction on a source that was ingested without an LLM generator.
        const payload = job.payload as { sourceId?: string };
        if (!payload.sourceId) throw new Error('re_extract requires a sourceId in payload');
        if (!this.generate) throw new Error('re_extract requires an LLM generator — configure a provider first');
        const ingester = new DocumentIngester(this.fabric, this.generate);
        const jobId = job.id;
        const result = await ingester.reExtractSource(payload.sourceId, {
          generate: this.generate,
          embed: this.embed,
          shouldCancel: () => this.cancelledJobIds.has(jobId),
          onProgress: (event) => {
            void claimed.setProgressEvent(event.progress, {
              stage: event.stage,
              detail: event.detail,
              chunkIndex: event.chunkIndex,
              chunkCount: event.chunkCount,
              batchIndex: event.batchIndex,
              batchCount: event.batchCount,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
            });
          },
        });
        this.cancelledJobIds.delete(jobId);
        return { ok: true, sourceId: result.sourceId, extractedNodes: result.extractedNodes, extractedEdges: result.extractedEdges, skipped: result.skipped };
      }
      case 'memory_consolidate': {
        const consolidator = new MemoryConsolidator(this.fabric);
        await consolidator.consolidate(job.payload as Record<string, unknown>);
        return;
      }
      case 'louvain_layout': {
        await this.fabric.computeLouvainLayout();
        return;
      }
      case 'community_summarize': {
        if (!this.generate || !this.embedder) {
          // Don't log a warning here — the enqueue logic in index.ts should
          // prevent these jobs from being created when no generator is available.
          // If we do get here, fail the job so it's visible in the queue dashboard
          // rather than silently marking it as "done".
          throw new Error('community_summarize requires an LLM generator and embedder — configure a provider first');
        }
        const summarizer = new CommunitySummarizer(this.fabric, this.generate, this.embedder);
        await summarizer.summarizeAll(job.payload as Record<string, unknown> | undefined);
        return;
      }
      case 'rag_telemetry': {
        await this.runRagTelemetry(claimed);
        return;
      }
      default:
        throw new Error(`Unknown job kind: ${job.kind}`);
    }
  }

  private async runRagTelemetry(claimed: ClaimedJob): Promise<void> {
    const judge = new LocalLLMJudge();
    const { rows } = await this.pool.query<{ id: string; content: string }>(
      `SELECT id, content FROM memory_nodes
       WHERE category IN ('semantic', 'source_doc') AND status = 'active'
       ORDER BY RANDOM() LIMIT 5`
    );
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const question = await judge.generate(`Generate a single concrete question that can be answered from the following text. Reply with only the question.\n\n${row.content.slice(0, 800)}`, { maxTokens: 64 });
      const embedding = await this.embed(question);
      const matches = await this.fabric.vectorSearch(embedding, { limit: 5, category: 'semantic' });
      const relevant = matches.slice(0, 3);
      const scores = {
        contextRelevance: relevant.length > 0 ? 1.0 : 0.0,
        groundedness: relevant.some((m) => m.content.includes(row.content.slice(0, 100))) ? 1.0 : 0.0,
        mrr: this.computeMrr(relevant, row.id),
      };
      await this.pool.query(
        `INSERT INTO benchmark_scorecards (run_id, model, provider, total_score, max_score, rag_triad, test_results, metadata, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (run_id) DO UPDATE SET rag_triad = EXCLUDED.rag_triad, test_results = EXCLUDED.test_results, updated_at = NOW()`,
        [
          `rag-telemetry-${row.id}`,
          'telemetry',
          'local',
          scores.contextRelevance + scores.groundedness + scores.mrr,
          3,
          JSON.stringify(scores),
          JSON.stringify([{ question, nodeId: row.id }]),
          JSON.stringify({ kind: 'rag_telemetry' }),
        ],
      );
      await claimed.setProgressEvent(Math.round(((i + 1) / rows.length) * 100), {
        stage: 'rag_telemetry',
        detail: `Telemetry probe ${i + 1}/${rows.length}`,
        chunkIndex: i + 1,
        chunkCount: rows.length,
      });
    }
  }

  private computeMrr(matches: { id: string }[], targetId: string): number {
    const rank = matches.findIndex((m) => m.id === targetId) + 1;
    return rank > 0 ? 1 / rank : 0;
  }
}
