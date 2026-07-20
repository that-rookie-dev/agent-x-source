import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
} from 'node:fs';
import multer from 'multer';
import { agentXConfigSchema, getDataDir } from '@agentx/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = getDataDir();
export const SESSIONS_DIR = join(DATA_DIR, 'sessions');
export const UPLOADS_DIR = join(DATA_DIR, 'uploads');

export const UI_DIST = process.env['AGENTX_UI_DIR'] || join(__dirname, '..', '..', 'web-ui', 'dist');
export const NEURON_DIST = process.env['AGENTX_NEURON_DIR'] || join(__dirname, '..', '..', 'web-neuron', 'dist');

export function getSessionDir(sessionId: string): string {
  return join(SESSIONS_DIR, sessionId);
}

export function ensureSessionDir(sessionId: string): string {
  const dir = getSessionDir(sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    const files = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
    for (const f of files) {
      const fp = join(dir, f);
      if (!existsSync(fp)) {
        writeFileSync(fp, '', 'utf-8');
      }
    }
  }
  return dir;
}

// Map plan objects to their creating orchestrator without mutating the plan
// Use a WeakMap so entries are eligible for GC when the plan object is no longer referenced
export const planOrchestratorMap = new WeakMap<object, unknown>();
// Also keep a Map from plan id -> orchestrator to allow execution by plan id
export const planOrchestratorById = new Map<string, unknown>();

// Atomic file write — write to temp file, then rename to prevent partial writes
export function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + Date.now();
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const result = agentXConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return { valid: false, errors };
  }
  return { valid: true, errors: [] };
}

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

function detectFileType(filePath: string): string {
  try {
    const fd = readFileSync(filePath);
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
    } catch {
      // Binary
    }

    return 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

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

export function validateUploadedFile(filePath: string, originalName: string): { valid: boolean; detectedType: string; error?: string } {
  const detectedType = detectFileType(filePath);

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
