/**
 * Shared helpers for memory API route modules.
 *
 * Provides singleton accessors for MemoryService / MemoryFabric used by
 * neural-brain routes and Agent-facing memory fabric APIs.
 */
import type { Response } from 'express';
import { MemoryFabric, MemoryService } from '@agentx/engine';
import { getEngine } from '../engine.js';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

let memoryService: MemoryService | null = null;

export function getMemoryService(): MemoryService | null {
  const pool = getEngine().pgPool;
  if (!pool) return null;
  if (!memoryService) {
    memoryService = new MemoryService({ pool });
    if (process.env['AGENTX_VAULT_KEY']) {
      try {
        const key = Buffer.from(process.env['AGENTX_VAULT_KEY'], 'base64');
        memoryService.setVault(key);
      } catch (e) {
        logger.error('MEMORY_API', `Failed to initialize secure vault: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return memoryService;
}

export function getFabric(): MemoryFabric | null {
  return getMemoryService()?.getFabric() ?? null;
}

export function handleFabricUnavailable(res: Response): void {
  res.status(503).json({ error: 'Memory fabric unavailable: PostgreSQL pool not connected' });
}
