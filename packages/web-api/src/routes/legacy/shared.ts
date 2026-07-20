/**
 * Shared context for legacy route modules.
 *
 * Contains constants, helper functions, and shared state that was
 * originally defined inline in legacy.ts. Each sub-router module
 * imports from here to avoid duplication.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { join, dirname, basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDataDir, getLogger, agentXConfigSchema } from '@agentx/shared';
import type { AgentXConfig, TurnAttachment } from '@agentx/shared';

// ─────────────────────────────────────────────────────────────
// Directory constants
// ─────────────────────────────────────────────────────────────

export const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = getDataDir();
export const SESSIONS_DIR = join(DATA_DIR, 'sessions');
export const UPLOADS_DIR = join(DATA_DIR, 'uploads');

export const UI_DIST = process.env['AGENTX_UI_DIR'] || join(__dirname, '..', '..', 'web-ui', 'dist');

export const BUNDLED_EMBEDDING_MODEL_DIR = join(__dirname, 'models');

// ─────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────

/** Map plan objects to their creating orchestrator (WeakMap for GC). */
export const planOrchestratorMap = new WeakMap<object, unknown>();
/** Map from plan id -> orchestrator to allow execution by plan id. */
export const planOrchestratorById = new Map<string, unknown>();

// ─────────────────────────────────────────────────────────────
// Shared helper functions
// ─────────────────────────────────────────────────────────────

export function getSessionDir(sessionId: string): string {
  return join(SESSIONS_DIR, sessionId);
}

export async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function ensureSessionDir(sessionId: string): Promise<string> {
  const dir = getSessionDir(sessionId);
  if (!(await pathExists(dir))) {
    await mkdir(dir, { recursive: true });
    const files = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
    for (const f of files) {
      const fp = join(dir, f);
      if (!(await pathExists(fp))) {
        await writeFile(fp, '', 'utf-8');
      }
    }
  }
  return dir;
}

/** Atomic file write — write to temp file, then rename to prevent partial writes. */
export async function atomicWriteFileSync(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + '.tmp.' + Date.now();
  await writeFile(tmpPath, content, 'utf-8');
  await rename(tmpPath, filePath);
}

export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const result = agentXConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`);
    return { valid: false, errors };
  }
  return { valid: true, errors: [] };
}

// ─────────────────────────────────────────────────────────────
// File upload validation
// ─────────────────────────────────────────────────────────────

const FILE_MAGIC_BYTES: Record<string, { offset: number; bytes: number[]; mime: string }[]> = {
  'image': [
    { offset: 0, bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },
    { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png' },
    { offset: 0, bytes: [0x47, 0x49, 0x46], mime: 'image/gif' },
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' },
    { offset: 0, bytes: [0x42, 0x4D], mime: 'image/bmp' },
  ],
  'document': [
    { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' },
    { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/zip' },
    { offset: 0, bytes: [0x7B, 0x5C, 0x72, 0x74], mime: 'application/rtf' },
  ],
  'text': [
    { offset: 0, bytes: [0xEF, 0xBB, 0xBF], mime: 'text/plain; charset=utf-8-bom' },
  ],
};

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'application/pdf', 'application/zip',
  'text/plain', 'text/csv', 'text/markdown', 'text/html',
  'application/json', 'application/xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const BLOCKED_MIME_TYPES = new Set([
  'application/x-executable', 'application/x-sharedlib', 'application/x-dosexec',
  'application/x-msdownload', 'application/x-msdos-program',
  'application/java-archive', 'application/x-java-applet',
  'application/x-sh', 'application/x-csh', 'application/x-bash',
  'text/x-script.python', 'text/x-python',
  'application/x-httpd-php',
]);

export async function detectFileType(filePath: string): Promise<string> {
  try {
    const fd = await readFile(filePath);
    if (fd.length === 0) return 'application/octet-stream';
    for (const [, sigs] of Object.entries(FILE_MAGIC_BYTES)) {
      for (const sig of sigs) {
        if (fd.length < sig.offset + sig.bytes.length) continue;
        const matches = sig.bytes.every((b, i) => fd[sig.offset + i] === b);
        if (matches) return sig.mime;
      }
    }
    try {
      const text = fd.toString('utf-8');
      const printable = Array.from(text).filter(c => c >= ' ' || c === '\n' || c === '\r' || c === '\t').length;
      if (printable > text.length * 0.9 && text.length > 0) {
        return 'text/plain';
      }
    } catch { /* Binary */ }
    return 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

export async function validateUploadedFile(filePath: string, originalName: string): Promise<{ valid: boolean; detectedType: string; error?: string }> {
  const detectedType = await detectFileType(filePath);
  if (BLOCKED_MIME_TYPES.has(detectedType)) {
    return { valid: false, detectedType, error: `File type '${detectedType}' is not allowed (executable/script detected)` };
  }
  if (ALLOWED_MIME_TYPES.has(detectedType)) {
    return { valid: true, detectedType };
  }
  if (detectedType === 'application/octet-stream') {
    const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
    const dangerousExtensions = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'jar', 'class', 'wasm', 'dll', 'so', 'dylib', 'app', 'deb', 'rpm']);
    if (dangerousExtensions.has(ext)) {
      return { valid: false, detectedType, error: `File extension '.${ext}' is not allowed` };
    }
    return { valid: true, detectedType };
  }
  return { valid: true, detectedType };
}

export const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const blockedExtensions = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'jar', 'wasm', 'dll', 'so', 'dylib']);
    if (blockedExtensions.has(ext)) {
      cb(new Error(`File extension '.${ext}' is not allowed`));
      return;
    }
    cb(null, true);
  },
});

// ─────────────────────────────────────────────────────────────
// Sub-router interface
// ─────────────────────────────────────────────────────────────

/**
 * Each sub-router module exports a function with this signature.
 * It receives the shared context and returns an Express Router
 * that the main legacy router mounts.
 */
export type SubRouterFactory = () => Router;

// ─────────────────────────────────────────────────────────────
// Agent runtime helpers
// ─────────────────────────────────────────────────────────────

/** Wait for an agent to stop processing, up to maxWait ms. */
export async function waitForIdle(agent: { processing: boolean }, maxWait = 3000): Promise<void> {
  const start = Date.now();
  while (agent.processing && (Date.now() - start) < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// ─────────────────────────────────────────────────────────────
// Chat message queue (shared mutable state)
// ─────────────────────────────────────────────────────────────

export const messageQueue: Array<{
  text: string;
  attachments?: TurnAttachment[];
  delegateCrewIds?: string[];
  crewSuggestionResolved?: boolean;
  crewIntakeFromPicker?: boolean;
  primaryCrewId?: string;
}> = [];
