/**
 * Shared helpers for memory API route modules.
 *
 * Extracted from memory-api.ts. Provides singleton accessors for
 * MemoryService / MemoryFabric / IngestionQueue, file-type detection,
 * content parsing, and the multer upload instance.
 */
import type { Request, Response } from 'express';
import { MemoryFabric, MemoryService, IngestionQueue } from '@agentx/engine';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import multer from 'multer';
import { getEngine } from '../engine.js';
import { getLogger, getDataDir } from '@agentx/shared';

const logger = getLogger();

// Persistent storage for RAG Studio file uploads.
export const RAG_STUDIO_DIR = join(getDataDir(), 'rag-studio');
try { if (!existsSync(RAG_STUDIO_DIR)) { void mkdir(RAG_STUDIO_DIR, { recursive: true }); } } catch { /* best-effort */ }

let memoryService: MemoryService | null = null;
let queueInstance: IngestionQueue | null = null;

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

export function getQueue(): IngestionQueue | null {
  const pool = getEngine().pgPool;
  if (!pool) return null;
  if (!queueInstance) {
    queueInstance = new IngestionQueue(pool);
  }
  return queueInstance;
}

// ─── File-type detection helpers ───

export const EXT_KIND_MAP: Record<string, 'pdf' | 'text' | 'markdown' | 'json' | 'web'> = {
  '.pdf': 'pdf',
  '.txt': 'text',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.htm': 'web',
  '.html': 'web',
};

export function detectKind(filename: string): 'pdf' | 'text' | 'markdown' | 'json' | 'web' {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  return EXT_KIND_MAP[ext] ?? 'text';
}

export async function parseFileContent(
  filePath: string,
  originalName: string,
  kind: 'pdf' | 'text' | 'markdown' | 'json' | 'web',
): Promise<{ content: string; pages?: number; title?: string }> {
  const buffer = await readFile(filePath);
  if (kind === 'pdf') {
    const { parsePdf } = await import('@agentx/engine');
    const parsed = await parsePdf(buffer);
    return { content: parsed.text, pages: parsed.pages, title: originalName };
  }
  if (kind === 'web') {
    const { extractArticle } = await import('@agentx/engine');
    const html = buffer.toString('utf-8');
    const article = extractArticle(html);
    return { content: article.content || html, title: article.title || originalName };
  }
  // text, markdown, json — read as UTF-8
  return { content: buffer.toString('utf-8'), title: originalName };
}

export function handleFabricUnavailable(res: Response): void {
  res.status(503).json({ error: 'Memory fabric unavailable: PostgreSQL pool not connected' });
}

export const upload = multer({ dest: join(RAG_STUDIO_DIR, '_tmp'), limits: { fileSize: 50 * 1024 * 1024 } });
