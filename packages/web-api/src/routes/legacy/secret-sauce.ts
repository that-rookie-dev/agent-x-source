import { Router } from 'express';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getLogger, getConfigDir } from '@agentx/shared';
import { pathExists, atomicWriteFileSync } from './shared.js';

const SECRET_SAUCE_FILES = ['SOUL', 'IDENTITY', 'DIARY', 'MEMORIES', 'PERMISSION', 'CREW'] as const;
type SecretSauceFile = typeof SECRET_SAUCE_FILES[number];
function secretSaucePath(file: string): string | null {
  const upper = file.toUpperCase();
  if (!(SECRET_SAUCE_FILES as readonly string[]).includes(upper)) return null;
  return join(process.cwd(), 'data', 'secret-sauce', `${upper}.md`);
}

export function createSecretSauceRouter(): Router {
  const r = Router();

  r.get('/api/secret-sauce', async (_req, res) => {
    const files: Array<{ file: SecretSauceFile; size: number; exists: boolean }> = [];
    for (const f of SECRET_SAUCE_FILES) {
      const p = join(process.cwd(), 'data', 'secret-sauce', `${f}.md`);
      if (await pathExists(p)) {
        try {
          const content = await readFile(p, 'utf-8');
          files.push({ file: f, size: content.length, exists: true });
        } catch (e) { files.push({ file: f, size: 0, exists: true }); }
      } else {
        files.push({ file: f, size: 0, exists: false });
      }
    }
    res.json({ files });
  });

  r.get('/api/secret-sauce/:file', async (req, res) => {
    const p = secretSaucePath(req.params['file']!);
    if (!p) { res.status(400).json({ error: 'invalid-file' }); return; }
    if (!(await pathExists(p))) { res.json({ content: '', exists: false }); return; }
    try {
      const content = await readFile(p, 'utf-8');
      res.json({ content, exists: true });
    } catch (e: unknown) {
      getLogger().error('GET_API_SECRET_SAUCE_FILE', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'read-failed' });
    }
  });

  r.put('/api/secret-sauce/:file', async (req, res) => {
    const p = secretSaucePath(req.params['file']!);
    if (!p) { res.status(400).json({ error: 'invalid-file' }); return; }
    const { content } = req.body as { content?: string };
    if (typeof content !== 'string') { res.status(400).json({ error: 'content-required' }); return; }
    try {
      const dir = join(process.cwd(), 'data', 'secret-sauce');
      if (!(await pathExists(dir))) await mkdir(dir, { recursive: true });
      await writeFile(p, content, 'utf-8');
      res.json({ ok: true, size: content.length });
    } catch (e: unknown) {
      getLogger().error('PUT_API_SECRET_SAUCE_FILE', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'write-failed' });
    }
  });

  return r;
}
