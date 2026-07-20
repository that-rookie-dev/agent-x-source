/**
 * Memory nodes/edges/graph route group.
 *
 * Extracted from memory-api.ts. Handles CRUD for memory nodes, edges,
 * neurons, search, graph walks, graph snapshots, and consolidation.
 */
import { Router, type Request, type Response } from 'express';
import type { MemoryNodeCategory } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { validate, memoryNodeCreateSchema, memoryEdgeCreateSchema, memorySearchSchema, memoryGraphWalkSchema, memoryContextSchema } from '../validation.js';
import { broadcastBrainActivity } from '../ws.js';
import { getMemoryService, getFabric, handleFabricUnavailable } from './shared.js';

const logger = getLogger();

export function createNodesRouter(): Router {
  const r = Router();

  r.post('/memory/context', validate(memoryContextSchema), async (req: Request, res: Response) => {
    const service = getMemoryService();
    if (!service) return handleFabricUnavailable(res);
    try {
      const { query, sessionId, agentId, limit, useWeights, episodicLimit, semanticLimit, graphDepth } = req.body;
      const result = await service.assembleContextResult(sessionId ?? '', query, {
        embedding: req.body.embedding,
        agentId,
        limit,
        useWeights,
        episodicLimit: episodicLimit ?? limit ?? 5,
        semanticLimit: semanticLimit ?? limit ?? 10,
        graphDepth,
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to assemble context' });
    }
  });

  r.post('/memory/nodes', validate(memoryNodeCreateSchema), async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const node = await fabric.createNode(req.body);
      broadcastBrainActivity({
        type: 'neuron_created',
        nodeId: node.id,
        label: node.label,
        category: node.category,
        content: node.content,
        x: node.x ?? null,
        y: node.y ?? null,
        timestamp: new Date().toISOString(),
      });
      res.json(node);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to create memory node' });
    }
  });

  r.post('/memory/edges', validate(memoryEdgeCreateSchema), async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const edge = await fabric.bindEdge(req.body);
      broadcastBrainActivity({
        type: 'synapse_bound',
        edgeId: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        relationshipType: edge.relationshipType,
        weight: edge.weight,
        timestamp: new Date().toISOString(),
      });
      res.json(edge);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to bind memory edge' });
    }
  });

  r.post('/memory/neurons/:id/fire', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Node id is required' });
    try {
      await fabric.fireNeuron(id);
      res.json({ ok: true });
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to fire neuron' });
    }
  });

  r.get('/memory/nodes/:id', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Node id is required' });
    try {
      const node = await fabric.getNode(id);
      if (!node) return res.status(404).json({ error: 'Node not found' });
      res.json(node);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get memory node' });
    }
  });

  r.post('/memory/search', validate(memorySearchSchema), async (req: Request, res: Response) => {
    const service = getMemoryService();
    if (!service) return handleFabricUnavailable(res);
    try {
      const results = await service.search('', {
        embedding: req.body.embedding,
        limit: req.body.limit,
        category: req.body.category ?? undefined,
        agentId: req.body.agentId ?? undefined,
      });
      res.json(results);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to search memory' });
    }
  });

  r.post('/memory/graph/walk', validate(memoryGraphWalkSchema), async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const result = await fabric.graphWalk(req.body);
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to walk memory graph' });
    }
  });

  r.get('/memory/graph', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 1000;
      const category = (req.query.category as string) || undefined;
      const tag = (req.query.tag as string) || undefined;
      const sourceId = (req.query.sourceId as string) || undefined;
      const isBenchmark = req.query.isBenchmark === 'true' ? true : req.query.isBenchmark === 'false' ? false : undefined;
      const result = await fabric.getGraphSnapshot({
        limit: Number.isNaN(limit) ? 1000 : limit,
        category: category as MemoryNodeCategory,
        tag,
        isBenchmark,
        sourceId,
      });
      res.json(result);
    } catch (e) {
      logger.error('MEMORY_API', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get graph snapshot' });
    }
  });

  return r;
}
