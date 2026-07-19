/**
 * Memory API router — thin aggregator.
 *
 * All route handlers have been extracted into domain-specific modules
 * under ./memory/. This file mounts them on a single Router and exports
 * it as `memoryRouter`.
 */
import { Router } from 'express';
import { createNodesRouter } from './memory/nodes.js';
import { createBenchmarkRouter } from './memory/benchmark.js';
import { createMaintenanceRouter } from './memory/maintenance.js';
import { createVaultRouter } from './memory/vault.js';
import { createGraphLayoutRouter } from './memory/graph-layout.js';
import { createSourcesRouter } from './memory/sources.js';

const router: Router = Router();

router.use(createNodesRouter());
router.use(createBenchmarkRouter());
router.use(createMaintenanceRouter());
router.use(createVaultRouter());
router.use(createGraphLayoutRouter());
router.use(createSourcesRouter());

export { router as memoryRouter };
