import { Router } from 'express';
import { resolve, join, dirname, basename } from 'node:path';
import { readdir, stat, rename, readFile, writeFile, mkdir, rm, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { generateId, getHomeDir, getLogger, isPathInsideRoot } from '@agentx/shared';
import { UPLOADS_DIR, upload, validateUploadedFile, pathExists } from './shared.js';
import {
  getWorkspaceInfo,
  setWorkspacePath,
  type WorkspaceMigrateMode,
} from '../../workspace.js';

export function createFilesRouter(): Router {
  const r = Router();

  /** Global Agent-X Workspace (not per-session). */
  r.get('/api/workspace', (_req, res) => {
    try {
      res.json(getWorkspaceInfo());
    } catch (e: unknown) {
      getLogger().error('GET_API_WORKSPACE', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'workspace-failed' });
    }
  });

  r.post('/api/workspace', async (req, res) => {
    try {
      const body = req.body as { path?: string; mode?: WorkspaceMigrateMode };
      if (!body?.path || typeof body.path !== 'string') {
        res.status(400).json({ error: 'path-required' });
        return;
      }
      const mode = body.mode === 'copy' || body.mode === 'move' ? body.mode : 'switch';
      const result = await setWorkspacePath(body.path, mode);
      res.json(result);
    } catch (e: unknown) {
      getLogger().error('POST_API_WORKSPACE', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'workspace-update-failed' });
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

  /** Workspace file search for composer @ picker (scoped under active workspace). */
  r.get('/api/filesystem/files', async (req, res) => {
    try {
      const workspace = getWorkspaceInfo().path;
      const q = String(req.query['q'] ?? '').trim().toLowerCase();
      const limit = Math.min(Math.max(Number(req.query['limit']) || 40, 1), 80);
      const ignore = new Set([
        'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
        '__pycache__', '.turbo', '.cache', 'vendor', '.venv', 'venv',
        'graphify-out', '.pgvector-build',
      ]);
      const out: Array<{ name: string; path: string; relativePath: string }> = [];

      const walk = async (dir: string, depth: number): Promise<void> => {
        if (out.length >= limit || depth > 6) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (out.length >= limit) return;
          const name = entry.name;
          if (name.startsWith('.') || ignore.has(name)) continue;
          const full = join(dir, name);
          if (entry.isDirectory()) {
            await walk(full, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          if (!isPathInsideRoot(full, workspace)) continue;
          const relativePath = full.slice(workspace.length).replace(/^[/\\]/, '');
          if (q && !relativePath.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) continue;
          out.push({ name, path: full, relativePath });
        }
      };

      await walk(workspace, 0);
      out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      res.json({ workspace, files: out.slice(0, limit) });
    } catch (e) {
      getLogger().error('GET_API_FILESYSTEM_FILES', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'file-search-failed' });
    }
  });

  /**
   * Workspace directory browser for composer @ picker.
   * `path` is a workspace-relative folder (empty / "." = workspace root).
   */
  r.get('/api/filesystem/browse', async (req, res) => {
    try {
      const workspace = getWorkspaceInfo().path;
      const ignore = new Set([
        'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
        '__pycache__', '.turbo', '.cache', 'vendor', '.venv', 'venv',
        'graphify-out', '.pgvector-build',
      ]);
      const rawRel = String(req.query['path'] ?? '').trim().replace(/\\/g, '/');
      const rel = (!rawRel || rawRel === '.') ? '' : rawRel.replace(/^\/+/, '').replace(/\/+$/, '');
      const abs = rel ? resolve(workspace, rel) : resolve(workspace);
      if (!isPathInsideRoot(abs, workspace)) {
        res.status(400).json({ error: 'path-outside-workspace' });
        return;
      }
      const st = await stat(abs);
      if (!st.isDirectory()) {
        res.status(400).json({ error: 'not-a-directory' });
        return;
      }

      const entries = await readdir(abs, { withFileTypes: true });
      const dirs: Array<{ name: string; path: string; relativePath: string }> = [];
      const files: Array<{ name: string; path: string; relativePath: string }> = [];
      for (const entry of entries) {
        const name = entry.name;
        if (name.startsWith('.') || ignore.has(name)) continue;
        const full = join(abs, name);
        if (!isPathInsideRoot(full, workspace)) continue;
        const relativePath = full.slice(workspace.length).replace(/^[/\\]/, '');
        if (entry.isDirectory()) dirs.push({ name, path: full, relativePath });
        else if (entry.isFile()) files.push({ name, path: full, relativePath });
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      const parentRelative = rel.includes('/')
        ? rel.slice(0, rel.lastIndexOf('/'))
        : (rel ? '' : null);

      res.json({
        workspace,
        current: abs,
        relativePath: rel || '.',
        parentRelative,
        name: rel ? basename(abs) : (basename(workspace) || 'workspace'),
        dirs,
        files,
      });
    } catch (e) {
      getLogger().error('GET_API_FILESYSTEM_BROWSE', e instanceof Error ? e : String(e));
      res.status(500).json({ error: 'browse-failed' });
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
