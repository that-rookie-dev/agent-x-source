/**
 * Model capability benchmark API — SSE progress stream for agentic clearance scans.
 */
import { Router, type Request, type Response } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelCapability, ProviderId } from '@agentx/shared';
import { getDataDir, getLogger } from '@agentx/shared';
import {
  ProviderFactory,
  runModelBenchmark,
  formatBenchmarkLog,
  benchmarkArtifactBasename,
  type BenchmarkProgressEvent,
  type BenchmarkRunResult,
} from '@agentx/engine';
import { getEngine } from './engine.js';

const router: import('express').Router = Router();

const BENCHMARK_DIR = join(getDataDir(), 'model-benchmarks');
if (!existsSync(BENCHMARK_DIR)) {
  try { mkdirSync(BENCHMARK_DIR, { recursive: true }); } catch { /* ignore */ }
}

interface ActiveRun {
  runId: string;
  events: BenchmarkProgressEvent[];
  listeners: Set<(event: BenchmarkProgressEvent) => void>;
  result?: BenchmarkRunResult;
  error?: string;
  done: boolean;
}

const activeRuns = new Map<string, ActiveRun>();

function artifactPaths(providerId: string, modelId: string): { json: string; log: string; basename: string } {
  const basename = benchmarkArtifactBasename(providerId, modelId);
  return {
    basename,
    json: join(BENCHMARK_DIR, `${basename}.json`),
    log: join(BENCHMARK_DIR, `${basename}.log`),
  };
}

function persistResult(result: BenchmarkRunResult): BenchmarkRunResult {
  const paths = artifactPaths(result.providerId, result.modelId);
  const enriched: BenchmarkRunResult = { ...result, logFile: `${paths.basename}.log` };
  try {
    writeFileSync(paths.json, JSON.stringify(enriched, null, 2), 'utf-8');
    writeFileSync(paths.log, formatBenchmarkLog(enriched), 'utf-8');
  } catch (e) {
    getLogger().warn('model-benchmark-persist-failed', e instanceof Error ? e.message : String(e));
  }
  return enriched;
}

function ensureLogFile(result: BenchmarkRunResult, cached = false): string {
  const paths = artifactPaths(result.providerId, result.modelId);
  try {
    if (!existsSync(paths.log)) {
      writeFileSync(paths.log, formatBenchmarkLog(result, { cached }), 'utf-8');
    }
  } catch (e) {
    getLogger().warn('model-benchmark-log-write-failed', e instanceof Error ? e.message : String(e));
  }
  return paths.log;
}

function loadCached(providerId: string, modelId: string): BenchmarkRunResult | null {
  const paths = artifactPaths(providerId, modelId);
  if (!existsSync(paths.log) && !existsSync(paths.json)) return null;
  try {
    if (existsSync(paths.json)) {
      const result = JSON.parse(readFileSync(paths.json, 'utf-8')) as BenchmarkRunResult;
      ensureLogFile(result);
      return { ...result, logFile: `${paths.basename}.log`, fromCache: true };
    }
    return null;
  } catch {
    return null;
  }
}

function resolveCredentials(body: {
  providerId: string;
  profileId?: string;
  apiKey?: string;
  baseUrl?: string;
}): { apiKey?: string; baseUrl?: string } {
  if (body.apiKey || body.baseUrl) {
    return { apiKey: body.apiKey, baseUrl: body.baseUrl };
  }
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const creds = cfg.provider.providers[body.providerId];
    if (!creds) return {};
    if (body.profileId && creds.profiles?.[body.profileId]) {
      const prof = creds.profiles[body.profileId] as { apiKey?: string; baseUrl?: string };
      return { apiKey: prof.apiKey, baseUrl: prof.baseUrl };
    }
    if (creds.activeProfile && creds.profiles?.[creds.activeProfile]) {
      const active = creds.profiles[creds.activeProfile] as { apiKey?: string; baseUrl?: string };
      return { apiKey: active.apiKey, baseUrl: active.baseUrl };
    }
    return { apiKey: creds.apiKey, baseUrl: creds.baseUrl };
  } catch {
    return {};
  }
}

function emit(run: ActiveRun, event: BenchmarkProgressEvent): void {
  run.events.push(event);
  for (const listener of run.listeners) listener(event);
}

function replayCachedRun(run: ActiveRun, cached: BenchmarkRunResult): void {
  const total = cached.tests.length;
  emit(run, {
    type: 'started',
    runId: run.runId,
    modelId: cached.modelId,
    providerId: cached.providerId,
    totalTests: total,
  });
  emit(run, { type: 'phase', phase: 'core', message: 'Loading archived clearance record…' });
  cached.tests.forEach((test, i) => {
    emit(run, {
      type: 'test_start',
      testId: test.id,
      label: test.label,
      index: i + 1,
      total,
    });
    emit(run, { type: 'test_complete', result: test, index: i + 1, total });
  });
  emit(run, { type: 'phase', phase: 'modality', message: 'Restoring sensory channel probes…' });
  for (const modality of cached.modalities) {
    emit(run, { type: 'modality', result: modality });
  }
  emit(run, { type: 'phase', phase: 'grading', message: 'Archive loaded — clearance verdict restored' });
  const result = { ...cached, runId: run.runId, fromCache: true };
  run.result = result;
  run.done = true;
  emit(run, { type: 'complete', result });
}

router.post('/model-benchmark/start', async (req, res) => {
  try {
    const body = req.body as {
      providerId: string;
      modelId: string;
      profileId?: string;
      apiKey?: string;
      baseUrl?: string;
      modelCapabilities?: string[];
      force?: boolean;
    };

    if (!body.providerId || !body.modelId) {
      res.status(400).json({ error: 'providerId and modelId are required' });
      return;
    }

    const paths = artifactPaths(body.providerId, body.modelId);

    if (!body.force) {
      const cached = loadCached(body.providerId, body.modelId);
      if (cached && existsSync(paths.log)) {
        const runId = crypto.randomUUID();
        const run: ActiveRun = { runId, events: [], listeners: new Set(), done: false };
        activeRuns.set(runId, run);
        res.json({
          runId,
          cached: true,
          logFile: cached.logFile ?? `${paths.basename}.log`,
          finishedAt: cached.finishedAt,
        });
        setImmediate(() => {
          replayCachedRun(run, cached);
          setTimeout(() => activeRuns.delete(runId), 10 * 60 * 1000);
        });
        return;
      }
    }

    const creds = resolveCredentials(body);
    const provider = ProviderFactory.create(body.providerId as ProviderId, creds.apiKey, creds.baseUrl);

    const runId = crypto.randomUUID();
    const run: ActiveRun = { runId, events: [], listeners: new Set(), done: false };
    activeRuns.set(runId, run);

    res.json({ runId, cached: false });

    void (async () => {
      try {
        const result = await runModelBenchmark(
          provider,
          {
            providerId: body.providerId,
            modelId: body.modelId,
            profileId: body.profileId,
            apiKey: creds.apiKey,
            baseUrl: creds.baseUrl,
            modelCapabilities: body.modelCapabilities as ModelCapability[] | undefined,
          },
          (event) => {
            if (event.type === 'complete') return;
            emit(run, event);
          },
        );
        const persisted = persistResult({ ...result, runId });
        run.result = persisted;
        run.done = true;
        emit(run, { type: 'complete', result: persisted });
      } catch (e) {
        run.error = e instanceof Error ? e.message : String(e);
        run.done = true;
        emit(run, { type: 'error', error: run.error });
      } finally {
        setTimeout(() => activeRuns.delete(runId), 10 * 60 * 1000);
      }
    })();
  } catch (e: unknown) {
    getLogger().error('POST_MODEL_BENCHMARK_START', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'benchmark-start-failed' });
  }
});

router.get('/model-benchmark/stream/:runId', (req: Request, res: Response) => {
  const runId = req.params.runId ?? '';
  if (!runId) {
    res.status(400).json({ error: 'runId required' });
    return;
  }
  const run = activeRuns.get(runId);
  if (!run) {
    res.status(404).json({ error: 'run-not-found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: BenchmarkProgressEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  for (const event of run.events) send(event);
  if (run.done) {
    res.end();
    return;
  }

  const listener = (event: BenchmarkProgressEvent) => {
    send(event);
    if (event.type === 'complete' || event.type === 'error') {
      run.listeners.delete(listener);
      res.end();
    }
  };

  run.listeners.add(listener);
  req.on('close', () => run.listeners.delete(listener));
});

router.get('/model-benchmark/latest', (req, res) => {
  const providerId = req.query.providerId as string;
  const modelId = req.query.modelId as string;
  if (!providerId || !modelId) {
    res.status(400).json({ error: 'providerId and modelId required' });
    return;
  }
  const result = loadCached(providerId, modelId);
  res.json({ result });
});

router.get('/model-benchmark/log', (req, res) => {
  const providerId = req.query.providerId as string;
  const modelId = req.query.modelId as string;
  if (!providerId || !modelId) {
    res.status(400).json({ error: 'providerId and modelId required' });
    return;
  }
  const paths = artifactPaths(providerId, modelId);
  const cached = loadCached(providerId, modelId);
  if (!cached) {
    res.status(404).json({ error: 'benchmark-log-not-found' });
    return;
  }
  ensureLogFile(cached);
  if (!existsSync(paths.log)) {
    res.status(404).json({ error: 'benchmark-log-not-found' });
    return;
  }
  const filename = `${paths.basename}.log`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(readFileSync(paths.log, 'utf-8'));
});

router.get('/model-benchmark/log-path', (req, res) => {
  const providerId = req.query.providerId as string;
  const modelId = req.query.modelId as string;
  if (!providerId || !modelId) {
    res.status(400).json({ error: 'providerId and modelId required' });
    return;
  }
  const paths = artifactPaths(providerId, modelId);
  res.json({
    logFile: `${paths.basename}.log`,
    logPath: paths.log,
    exists: existsSync(paths.log),
  });
});

export default router;
