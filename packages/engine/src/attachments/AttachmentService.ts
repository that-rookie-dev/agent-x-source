import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StoredAttachment, AttachmentPreview } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { WorkerPool } from '../workers/WorkerPool.js';
import { getAttachmentWorkerLimit } from '../performance/PerformanceGovernor.js';

const ALLOWED_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/markdown', 'text/html', 'text/css',
  'application/json', 'application/javascript', 'application/typescript',
  'application/x-typescript',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp',
  '.h', '.cs', '.rb', '.php', '.swift', '.kt', '.sh', '.bash', '.zsh',
  '.ps1', '.sql', '.yml', '.yaml', '.xml', '.toml', '.ini', '.cfg',
  '.conf', '.json', '.md', '.txt',
]);

const MAX_SIZE_MB = 25;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

interface AttachmentRegistry {
  [id: string]: StoredAttachment;
}

export interface RegisterAttachmentOptions {
  sessionId: string;
  filename: string;
  mimeType?: string;
  source?: string;
  /** If provided, the file is referenced in-place and not copied. */
  originalPath?: string;
  /** Mutually exclusive with originalPath. */
  dataUrl?: string;
  /** Mutually exclusive with originalPath/dataUrl. */
  buffer?: Buffer | Uint8Array | ArrayBuffer;
}

export class AttachmentService {
  private baseDir: string;
  private registryPath: string;
  private registry: AttachmentRegistry = {};
  private textCache = new Map<string, string | null>();
  private extractionPool: WorkerPool | null = null;

  constructor(dataDir: string) {
    this.baseDir = join(dataDir, 'files', 'attachments');
    this.registryPath = join(this.baseDir, 'attachments.json');
    void this.loadRegistry();
  }

  private async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  private async loadRegistry(): Promise<void> {
    try {
      const raw = await readFile(this.registryPath, 'utf-8');
      this.registry = JSON.parse(raw) as AttachmentRegistry;
    } catch {
      this.registry = {};
    }
  }

  private async saveRegistry(): Promise<void> {
    await this.ensureDir(dirname(this.registryPath));
    await writeFile(this.registryPath, JSON.stringify(this.registry, null, 2));
  }

  async registerAttachment(opts: RegisterAttachmentOptions): Promise<StoredAttachment> {
    const { sessionId, filename, source = 'tool' } = opts;
    let mimeType = opts.mimeType;
    let size = 0;
    let storagePath: string;
    let originalPath: string | undefined;
    let isTemp = false;
    const id = randomUUID();
    const sanitized = this.sanitizeFilename(filename || 'attachment');

    if (opts.originalPath) {
      if (!existsSync(opts.originalPath)) {
        throw new Error(`Original file not found: ${opts.originalPath}`);
      }
      originalPath = opts.originalPath;
      storagePath = originalPath;
      const stats = statSync(originalPath);
      size = stats.size;
      mimeType = mimeType ?? this.guessMimeFromExtension(sanitized);
    } else {
      let buffer: Buffer;
      if (opts.dataUrl) {
        const match = opts.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new Error('Invalid data URL');
        const [, dataMime, base64] = match;
        buffer = Buffer.from(base64!, 'base64');
        mimeType = mimeType ?? dataMime ?? 'application/octet-stream';
      } else if (opts.buffer) {
        if (ArrayBuffer.isView(opts.buffer)) {
          buffer = Buffer.from(opts.buffer.buffer, opts.buffer.byteOffset, opts.buffer.byteLength);
        } else {
          buffer = Buffer.from(opts.buffer);
        }
        mimeType = mimeType ?? (await this.detectMime(buffer, sanitized));
      } else {
        throw new Error('registerAttachment requires originalPath, dataUrl, or buffer');
      }
      if (buffer.length > MAX_SIZE_BYTES) {
        throw new Error(`Attachment exceeds ${MAX_SIZE_MB}MB`);
      }
      size = buffer.length;
      storagePath = join('temp', sessionId, id, sanitized);
      const absolutePath = join(this.baseDir, storagePath);
      await this.ensureDir(dirname(absolutePath));
      await writeFile(absolutePath, buffer);
      isTemp = true;
    }

    const finalMime = mimeType ?? 'application/octet-stream';
    if (!this.isAllowedMime(finalMime, sanitized)) {
      throw new Error(`File type not allowed: ${finalMime}`);
    }

    const attachment: StoredAttachment = {
      id,
      sessionId,
      filename: sanitized,
      mimeType: finalMime,
      size,
      storagePath,
      originalPath,
      isTemp,
      source,
      createdAt: new Date().toISOString(),
    };
    await this.loadRegistry();
    this.registry[id] = attachment;
    await this.saveRegistry();
    return attachment;
  }

  async saveFromDataUrl(
    sessionId: string,
    filename: string,
    dataUrl: string,
    source: StoredAttachment['source'] = 'upload',
  ): Promise<StoredAttachment> {
    return this.registerAttachment({ sessionId, filename, dataUrl, source });
  }

  async saveFromBuffer(
    sessionId: string,
    filename: string,
    buffer: Buffer,
    mimeType: string,
    source: StoredAttachment['source'] = 'tool',
  ): Promise<StoredAttachment> {
    return this.registerAttachment({ sessionId, filename, buffer, mimeType, source });
  }

  getAttachment(id: string): StoredAttachment | null {
    return this.registry[id] ?? null;
  }

  /** Reuse an existing workspace registration when the same absolute path was already attached. */
  findByOriginalPath(originalPath: string): StoredAttachment | null {
    const target = originalPath;
    for (const a of Object.values(this.registry)) {
      if (a.originalPath === target) return a;
    }
    return null;
  }

  /** Resolves the best available absolute path for reading. */
  async resolveAttachmentPath(id: string): Promise<string | null> {
    const a = this.registry[id];
    if (!a) return null;
    if (a.originalPath && existsSync(a.originalPath)) {
      return a.originalPath;
    }
    const tempPath = join(this.baseDir, a.storagePath);
    if (existsSync(tempPath)) {
      return tempPath;
    }
    return null;
  }

  /** Backwards-compatible synchronous path resolver (temp-first, no existence check). */
  getAttachmentPath(id: string): string | null {
    const a = this.registry[id];
    if (!a) return null;
    if (a.originalPath) return a.originalPath;
    return join(this.baseDir, a.storagePath);
  }

  /** Returns true if at least one backing file (original or temp) currently exists. */
  async exists(id: string): Promise<boolean> {
    const a = this.registry[id];
    if (!a) return false;
    if (a.originalPath) {
      try {
        await stat(a.originalPath);
        return true;
      } catch { /* fallthrough */ }
    }
    try {
      await stat(join(this.baseDir, a.storagePath));
      return true;
    } catch {
      return false;
    }
  }

  async getBuffer(id: string): Promise<Buffer | null> {
    const path = await this.resolveAttachmentPath(id);
    if (!path) return null;
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  private extractionPoolMax = 0;

  private getExtractionPool(): WorkerPool {
    const maxWorkers = getAttachmentWorkerLimit();
    if (this.extractionPool && this.extractionPoolMax === maxWorkers) {
      return this.extractionPool;
    }
    if (this.extractionPool) {
      void this.extractionPool.terminate();
      this.extractionPool = null;
    }
    this.extractionPoolMax = maxWorkers;
    this.extractionPool = new WorkerPool({
      workerPath: new URL('./workers/AttachmentExtractWorker.js', import.meta.url),
      minWorkers: 0,
      maxWorkers,
      idleTimeoutMs: 60_000,
      inlineHandler: async (task) => {
        const { path, mimeType } = (task.payload ?? {}) as { path?: string; mimeType?: string };
        if (!path || !mimeType) throw new Error('Invalid extract task payload');
        const { extractFromPath } = await import('./extract.js');
        return extractFromPath(path, mimeType);
      },
    });
    return this.extractionPool;
  }

  async deleteAttachment(id: string): Promise<void> {
    const a = this.registry[id];
    if (!a) return;
    delete this.registry[id];
    await this.saveRegistry();
    if (a.isTemp) {
      const dir = dirname(join(this.baseDir, a.storagePath));
      await rm(dir, { recursive: true, force: true });
    }
  }

  async extractPreview(id: string): Promise<AttachmentPreview> {
    const a = this.getAttachment(id);
    if (!a) return { kind: 'error', content: 'Attachment not found' };
    const path = await this.resolveAttachmentPath(id);
    if (!path) return { kind: 'error', content: 'File not found or removed' };

    const cachedText = this.textCache.get(id);
    if (cachedText !== undefined) {
      return { kind: 'text', content: cachedText ?? '' };
    }

    let preview: AttachmentPreview;
    try {
      preview = await this.getExtractionPool().execute<AttachmentPreview>('extract', {
        payload: { path, mimeType: a.mimeType },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      getLogger().warn('ATTACHMENT_PREVIEW', `${id}: pool extract failed — ${message}`);
      preview = { kind: 'error', content: message };
    }

    // In-process fallback when the worker pool fails (common for PDFs in some runtimes).
    if (preview.kind === 'error') {
      try {
        const { extractFromPath } = await import('./extract.js');
        preview = await extractFromPath(path, a.mimeType);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        getLogger().warn('ATTACHMENT_PREVIEW', `${id}: inline extract failed — ${message}`);
        preview = { kind: 'error', content: message };
      }
    }

    // Last resort for PDFs: zero-dep stream extractor used by pdf_read.
    if (
      preview.kind === 'error'
      && (a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.filename))
    ) {
      try {
        const buffer = await readFile(path);
        const { extractPdfTextFromBuffer } = await import('../tools/builtin/documents.js');
        const text = extractPdfTextFromBuffer(buffer);
        if (text.trim()) {
          preview = { kind: 'text', content: text };
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        getLogger().warn('ATTACHMENT_PREVIEW', `${id}: pdf buffer extract failed — ${message}`);
      }
    }

    if (preview.kind === 'text') {
      this.textCache.set(id, preview.content ?? '');
    }
    return preview;
  }

  async extractTextForAgent(id: string): Promise<string | null> {
    const cached = this.textCache.get(id);
    if (cached !== undefined) return cached;

    const preview = await this.extractPreview(id);
    if (preview.kind === 'text' || preview.kind === 'html') {
      const text = preview.content ?? '';
      this.textCache.set(id, text);
      return text;
    }
    if (preview.kind === 'table' && preview.rows) {
      const lines = [
        (preview.headers ?? []).join('\t'),
        ...preview.rows.map((r: string[]) => r.join('\t')),
      ];
      const text = lines.join('\n');
      this.textCache.set(id, text);
      return text;
    }
    this.textCache.set(id, null);
    return null;
  }

  private async detectMime(buffer: Buffer, filename: string): Promise<string> {
    try {
      const { fileTypeFromBuffer } = await import('file-type');
      const ft = await fileTypeFromBuffer(buffer);
      if (ft) return ft.mime;
    } catch {
      /* fallthrough */
    }
    return this.guessMimeFromExtension(filename);
  }

  private guessMimeFromExtension(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json',
      js: 'application/javascript', ts: 'application/typescript', css: 'text/css',
      py: 'text/x-python', rs: 'text/x-rust', go: 'text/x-go', java: 'text/x-java',
    };
    return ext ? (map[ext] ?? 'application/octet-stream') : 'application/octet-stream';
  }

  private isAllowedMime(mime: string, filename: string): boolean {
    if (ALLOWED_MIMES.has(mime)) return true;
    if (mime.startsWith('text/')) return true;
    if (this.isCodeFile(filename)) return true;
    if (mime.startsWith('image/')) return true;
    return false;
  }

  private isCodeFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase();
    return ext ? CODE_EXTENSIONS.has(`.${ext}`) : false;
  }

  private sanitizeFilename(name: string): string {
    // eslint-disable-next-line no-control-regex -- strip illegal filename characters
    return basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'attachment';
  }

}
