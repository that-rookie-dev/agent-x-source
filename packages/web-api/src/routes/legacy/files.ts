import { Router } from 'express';
import { resolve, join, dirname, basename } from 'node:path';
import { readdir, stat, rename, readFile, writeFile, mkdir, rm, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { generateId, getDefaultWorkspaceDir, getHomeDir, getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { UPLOADS_DIR, upload, validateUploadedFile, pathExists, getSessionDir } from './shared.js';

export function createFilesRouter(): Router {
  const r = Router();

  r.get('/api/cwd', (_req, res) => {
    const eng = getEngine();
    const sess = eng.sessionManager.getActiveSession();
    const scopePath = sess?.scopePath ?? null;
    res.json({ cwd: scopePath });
  });

  r.get('/api/cwd/default', (_req, res) => {
    res.json({ path: getDefaultWorkspaceDir() });
  });

  r.post('/api/cwd', async (req, res) => {
    try {
      const { path } = req.body as { path: string };
      if (!path || typeof path !== 'string') { res.status(400).json({ error: 'path-required' }); return; }
      const resolved = resolve(path);
      const eng = getEngine();
      const sess = eng.sessionManager.getActiveSession();
      if (sess) {
        eng.sessionManager.updateSession({ scopePath: resolved });
        const ctxPath = join(getSessionDir(sess.id), 'context.json');
        try {
          let ctx: Record<string, unknown> = {};
          if (await pathExists(ctxPath)) {
            ctx = JSON.parse(await readFile(ctxPath, 'utf-8'));
          }
          ctx['scopePath'] = resolved;
          await mkdir(dirname(ctxPath), { recursive: true });
          await writeFile(ctxPath, JSON.stringify(ctx, null, 2));
        } catch (e) { /* best-effort */ }
      }
      const agent = eng.agent;
      if (agent && typeof agent.setScopePath === 'function') agent.setScopePath(resolved);
      res.json({ cwd: resolved });
    } catch (e: unknown) {
      getLogger().error('POST_API_CWD', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'scope-update-failed' });
    }
  });

  // Folder picker: list directories at a path
  r.get('/api/filesystem/dirs', async (req, res) => {
    try {
      const requestedPath = (req.query['path'] as string) || getHomeDir();
      const absPath = resolve(requestedPath);
      const entries = await readdir(absPath, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ name: e.name, path: join(absPath, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = dirname(absPath);
      const hasParent = absPath !== parent && absPath !== '/';
      res.json({ current: absPath, parent: hasParent ? parent : null, dirs });
    } catch (e) {
      getLogger().error('GET_API_FILESYSTEM_DIRS', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'dir-read-failed' });
    }
  });

  // ───── File Upload ─────
  r.post('/api/files/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Content-based file type validation (magic bytes, not user-supplied mime)
    const validation = await validateUploadedFile(req.file.path, req.file.originalname);
    if (!validation.valid) {
      // Clean up the rejected file
      try { await unlink(req.file.path); } catch { /* ignore */ }
      getLogger().warn('FILE_UPLOAD', `Rejected file '${req.file.originalname}': ${validation.error}`);
      res.status(400).json({ error: validation.error, detectedType: validation.detectedType });
      return;
    }

    const fileId = generateId('file_');
    const ext = basename(req.file.originalname).split('.').pop() ?? '';
    const destName = `${fileId}.${ext}`;
    const destPath = join(UPLOADS_DIR, destName);
    if (await pathExists(req.file.path)) {
      await rename(req.file.path, destPath);
    }
    // Save metadata including detected MIME type
    try {
      await writeFile(destPath + '.meta.json', JSON.stringify({
        originalName: req.file.originalname,
        mimeType: validation.detectedType,
        userMimeType: req.file.mimetype,
        size: req.file.size,
        uploadedAt: new Date().toISOString(),
      }), 'utf-8');
    } catch { /* best-effort */ }
    res.json({
      id: fileId,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: validation.detectedType,
      path: `/api/files/${fileId}`,
    });
  });

  r.get('/api/files', async (_req, res) => {
    try {
      if (!(await pathExists(UPLOADS_DIR))) {
        res.json({ files: [] });
        return;
      }
      const entries = await readdir(UPLOADS_DIR);
      const files = await Promise.all(entries
        .filter((e) => e !== '.gitkeep')
        .map(async (e) => {
          const fullPath = join(UPLOADS_DIR, e);
          try {
            const st = await stat(fullPath);
            if (!st.isFile()) return null;
            const metaPath = fullPath + '.meta.json';
            let meta: Record<string, unknown> = {};
            if (await pathExists(metaPath)) {
              try { meta = JSON.parse(await readFile(metaPath, 'utf-8')); } catch (e) { /* skip */ }
            }
            return {
              id: e.replace(/\.[^.]+$/, ''),
              name: (meta['originalName'] as string) ?? e,
              size: st.size,
              createdAt: st.birthtime.toISOString(),
            };
          } catch (e) { return null; }
        }));
      const filtered = files.filter((f): f is NonNullable<typeof f> => f !== null);
      res.json({ files: filtered });
    } catch (e: unknown) {
      getLogger().error('GET_API_FILES', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'list-files-failed' });
    }
  });

  r.get('/api/files/:id', async (req, res) => {
    const fileId = req.params['id']!;
    const entries = (await pathExists(UPLOADS_DIR)) ? await readdir(UPLOADS_DIR) : [];
    const match = entries.find((e) => e.startsWith(fileId));
    if (!match) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const filePath = join(UPLOADS_DIR, match);
    if (!(await pathExists(filePath))) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const st = await stat(filePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', st.size);
    res.setHeader('Content-Disposition', `inline; filename="${match}"`);
    createReadStream(filePath).pipe(res);
  });

  r.delete('/api/files/:id', async (req, res) => {
    const fileId = req.params['id']!;
    const entries = (await pathExists(UPLOADS_DIR)) ? await readdir(UPLOADS_DIR) : [];
    const match = entries.find((e) => e.startsWith(fileId));
    if (!match) {
      res.json({ ok: true });
      return;
    }
    const filePath = join(UPLOADS_DIR, match);
    const metaPath = filePath + '.meta.json';
    try {
      if (await pathExists(filePath)) await rm(filePath);
      if (await pathExists(metaPath)) await rm(metaPath);
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('DELETE_API_FILES_ID', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
    }
  });

  return r;
}
