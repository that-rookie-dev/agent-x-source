/**
 * Memory benchmark route group.
 *
 * Extracted from memory-api.ts. Handles cognitive benchmark runs,
 * scorecards, synaptic plasticity, and benchmark data wipe.
 */
import { Router, type Request, type Response } from 'express';
import { getLogger } from '@agentx/shared';
import { CognitiveBenchmark } from '@agentx/engine';
import { validate, benchmarkRunSchema } from '../validation.js';
import { broadcast, broadcastBrainActivity } from '../ws.js';
import { getEngine } from '../engine.js';
import { getFabric, handleFabricUnavailable } from './shared.js';

const logger = getLogger();

async function buildBenchmarkExecutor(): Promise<((prompt: string) => Promise<string>) | undefined> {
  const eng = getEngine();
  if (!eng.configured) return undefined;
  try {
    const cfg = eng.configManager.load();
    const providerId = cfg.provider.activeProvider;
    const providerCfg = cfg.provider.providers[providerId];
    if (!providerCfg?.configured || !providerCfg?.apiKey) return undefined;
    const { ProviderFactory } = await import('@agentx/engine');
    const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
    const model = cfg.provider.activeModel || 'gpt-4o-mini';
    return async (prompt: string) => {
      let text = '';
      const request = {
        model,
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0,
        maxTokens: 512,
        stream: false,
      };
      for await (const chunk of provider.complete(request)) {
        if (chunk.type === 'text_delta' && chunk.content) text += chunk.content;
      }
      return text;
    };
  } catch {
    return undefined;
  }
}

export function createBenchmarkRouter(): Router {
  const r = Router();

  r.post('/memory/benchmark', validate(benchmarkRunSchema), async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const execute = await buildBenchmarkExecutor();
      const benchmark = new CognitiveBenchmark(fabric, {
        onEvent: (event) => {
          if (event.type === 'benchmark_neuron_created') {
            broadcastBrainActivity({
              type: 'neuron_created',
              nodeId: event.nodeId,
              label: event.label,
              category: event.category,
              content: '',
              x: 0,
              y: 0,
              timestamp: event.timestamp,
            });
          } else if (event.type === 'benchmark_neuron_failed') {
            broadcastBrainActivity({
              type: 'neuron_decayed',
              nodeId: event.nodeId,
              status: 'failed',
              timestamp: event.timestamp,
            });
          }
          broadcast({ type: 'benchmark_event', event });
        },
      });
      // Run async so the HTTP response can stream progress via WebSocket
      benchmark.run({ ...req.body, execute }).then((result) => {
        broadcast({ type: 'benchmark_result', result });
      }).catch((e: unknown) => {
        broadcast({ type: 'benchmark_error', error: e instanceof Error ? e.message : String(e) });
      });
      res.json({ runId: benchmark.getRunId() });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to start benchmark' });
    }
  });

  r.get('/memory/benchmark/scorecards', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const scorecards = await fabric.getScorecards(50);
      res.json({ scorecards });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get scorecards' });
    }
  });

  r.post('/memory/plasticity', async (req: Request, res: Response) => {
    const { SynapticPlasticity } = await import('@agentx/engine');
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const plasticity = new SynapticPlasticity(fabric);
      const result = await plasticity.run(req.body);
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to run plasticity' });
    }
  });

  r.post('/memory/wipe-benchmark', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const result = await fabric.wipeBenchmark();
      broadcastBrainActivity({
        type: 'cluster_layout_updated',
        epoch: 0,
        count: -result.deletedNodes,
        timestamp: new Date().toISOString(),
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to wipe benchmark data' });
    }
  });

  return r;
}
