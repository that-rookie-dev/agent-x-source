/**
 * Memory jobs route group.
 *
 * Extracted from memory-api.ts. Handles job listing, status, events,
 * cancellation, deletion, and SSE streaming.
 */
import { Router, type Request, type Response } from 'express';
import { getLogger } from '@agentx/shared';
import type { JobKind, JobStatus } from '@agentx/engine';
import { getIngestionWorker } from '../ingestion-worker-ref.js';
import { getQueue, handleFabricUnavailable } from './shared.js';

const logger = getLogger();

export function createJobsRouter(): Router {
  const r = Router();

  r.get('/memory/jobs', async (req: Request, res: Response) => {
    const queue = getQueue();
    if (!queue) return handleFabricUnavailable(res);
    try {
      const kind = req.query.kind as JobKind | undefined;
      const status = req.query.status as JobStatus | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const jobs = await queue.getJobs({ kind, status, limit });
      res.json({ jobs });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to list jobs' });
    }
  });

  r.get('/memory/jobs/:id', async (req: Request, res: Response) => {
    const queue = getQueue();
    if (!queue) return handleFabricUnavailable(res);
    try {
      const job = await queue.getJob(req.params['id']!);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      res.json(job);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get job' });
    }
  });

  r.get('/memory/jobs/:id/events', async (req: Request, res: Response) => {
    const queue = getQueue();
    if (!queue) return handleFabricUnavailable(res);
    try {
      const events = await queue.getRecentEvents(req.params['id']!, 500);
      res.json({ events });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get events' });
    }
  });

  r.post('/memory/jobs/:id/cancel', async (req: Request, res: Response) => {
    const queue = getQueue();
    if (!queue) return handleFabricUnavailable(res);
    try {
      const jobId = req.params['id']!;
      const worker = getIngestionWorker();
      if (worker) {
        await worker.cancelJob(jobId);
      } else {
        await queue.cancelJob(jobId);
      }
      res.json({ ok: true });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to cancel job' });
    }
  });

  r.delete('/memory/jobs/:id', async (req: Request, res: Response) => {
    const queue = getQueue();
    if (!queue) return handleFabricUnavailable(res);
    try {
      const deleted = await queue.deleteJob(req.params['id']!);
      if (!deleted) return res.status(404).json({ error: 'Job not found' });
      res.json({ ok: true });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to delete job' });
    }
  });

  /**
   * GET /memory/jobs/:id/stream  — SSE stream that polls job progress and pushes
   * updates to the client until the job reaches a terminal state.
   */
  r.get('/memory/jobs/:id/stream', async (req: Request, res: Response) => {
    const queue = getQueue();
    if (!queue) return handleFabricUnavailable(res);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const jobId = req.params['id']!;
    let lastEventId = 0;
    let lastStatus = '';
    let firstPoll = true;
    let closed = false;

    req.on('close', () => { closed = true; });

    const poll = async () => {
      try {
        const job = await queue.getJob(jobId);
        if (!job) {
          res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
          return;
        }

        let events;
        if (firstPoll) {
          events = await queue.getRecentEvents(jobId, 200);
          firstPoll = false;
        } else {
          events = await queue.getEventsSince(jobId, lastEventId, 200);
        }

        for (const ev of events) {
          lastEventId = Math.max(lastEventId, ev.id);
          const event = {
            jobId: job.id,
            stage: ev.stage,
            progress: ev.progress,
            status: job.status,
            detail: ev.detail ?? undefined,
            chunkIndex: ev.chunkIndex ?? undefined,
            chunkCount: ev.chunkCount ?? undefined,
            batchIndex: ev.batchIndex ?? undefined,
            batchCount: ev.batchCount ?? undefined,
            inputTokens: ev.inputTokens ?? undefined,
            outputTokens: ev.outputTokens ?? undefined,
            totalInputTokens: job.totalInputTokens ?? undefined,
            totalOutputTokens: job.totalOutputTokens ?? undefined,
            error: job.error ?? undefined,
            updatedAt: new Date(ev.createdAt).toISOString(),
          };
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        if (job.status !== lastStatus) {
          lastStatus = job.status;
          const sd = job.stageDetail;
          const stage = sd?.stage ?? (job.status === 'done' ? 'complete' : job.status === 'failed' ? 'error' : job.status === 'pending' ? 'queued' : 'processing');
          const event = {
            jobId: job.id,
            stage,
            progress: job.progress,
            status: job.status,
            detail: sd?.detail ?? (job.status === 'failed' ? job.error : undefined),
            chunkIndex: sd?.chunkIndex ?? undefined,
            chunkCount: sd?.chunkCount ?? undefined,
            batchIndex: sd?.batchIndex ?? undefined,
            batchCount: sd?.batchCount ?? undefined,
            error: job.error ?? undefined,
            updatedAt: new Date().toISOString(),
          };
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
          return; // terminal — stop polling
        }
      } catch {
        // best-effort — keep polling
      }
      if (!closed) {
        setTimeout(poll, 1000);
      }
    };

    void poll();

    const heartbeat = setInterval(() => {
      if (closed) { clearInterval(heartbeat); return; }
      res.write(': keepalive\n\n');
    }, 15000);
    req.on('close', () => clearInterval(heartbeat));
  });

  return r;
}
