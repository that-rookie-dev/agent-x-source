import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { TemplateField, UpdateDocumentTemplateInput } from '@agentx/shared';
import { getTemplateService } from '../services/templates.js';
import type { ApiContext } from '../services/ApiService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const ACCEPTED = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/pdf',
  'application/octet-stream',
]);

function guessMimeFromName(name: string, fallback: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pdf: 'application/pdf',
  };
  return map[ext] ?? fallback;
}

function normalizeFields(raw: unknown): TemplateField[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const fields: TemplateField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key.trim() : '';
    if (!key) continue;
    const field: TemplateField = {
      key,
      label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : key,
      required: o.required !== false,
    };
    if (typeof o.example === 'string') field.example = o.example;
    fields.push(field);
  }
  return fields;
}

export function router(_ctx: ApiContext): Router {
  const r = Router();

  r.get('/templates', async (_req: Request, res: Response) => {
    const svc = await getTemplateService();
    if (!svc) {
      res.status(503).json({ error: 'Templates unavailable' });
      return;
    }
    try {
      const templates = await svc.list();
      res.json({ templates });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/templates/upload', upload.single('file'), async (req: Request, res: Response) => {
    const svc = await getTemplateService();
    if (!svc) {
      res.status(503).json({ error: 'Templates unavailable' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }
    const mime = guessMimeFromName(file.originalname, file.mimetype || 'application/octet-stream');
    if (!ACCEPTED.has(mime) && !/\.(docx|doc|xlsx|pptx|pdf)$/i.test(file.originalname)) {
      res.status(422).json({ error: 'Supported formats: .pdf, .docx, .doc, .xlsx, .pptx' });
      return;
    }
    try {
      const template = await svc.upload(file.buffer, file.originalname, mime);
      res.json({ template });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.get('/templates/:id', async (req: Request, res: Response) => {
    const svc = await getTemplateService();
    if (!svc) {
      res.status(503).json({ error: 'Templates unavailable' });
      return;
    }
    try {
      const template = await svc.get(String(req.params.id));
      if (!template) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
      res.json({ template });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.patch('/templates/:id', async (req: Request, res: Response) => {
    const svc = await getTemplateService();
    if (!svc) {
      res.status(503).json({ error: 'Templates unavailable' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: UpdateDocumentTemplateInput = {};
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if ('description' in body) {
      patch.description = typeof body.description === 'string' ? body.description : null;
    }
    if ('fields' in body) {
      const fields = normalizeFields(body.fields);
      if (fields) patch.fields = fields;
    }
    if (Array.isArray(body.tags)) {
      patch.tags = body.tags.map(String).map((t) => t.trim()).filter(Boolean);
    }
    try {
      const template = await svc.update(String(req.params.id), patch);
      if (!template) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
      res.json({ template });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/templates/:id/rescan', async (req: Request, res: Response) => {
    const svc = await getTemplateService();
    if (!svc) {
      res.status(503).json({ error: 'Templates unavailable' });
      return;
    }
    try {
      const template = await svc.rescanFields(String(req.params.id));
      if (!template) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
      res.json({ template });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/templates/:id/fill', async (req: Request, res: Response) => {
    const svc = await getTemplateService();
    if (!svc) {
      res.status(503).json({ error: 'Templates unavailable' });
      return;
    }
    const body = (req.body ?? {}) as {
      values?: Record<string, string>;
      outputName?: string;
      sessionId?: string;
    };
    if (!body.values || typeof body.values !== 'object') {
      res.status(400).json({ error: 'values object is required' });
      return;
    }
    try {
      const result = await svc.fill(String(req.params.id), {
        values: body.values,
        outputName: body.outputName,
        sessionId: body.sessionId,
      });
      res.json({ ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /not found/i.test(message) ? 404 : /not supported|reference file/i.test(message) ? 422 : 500;
      res.status(status).json({ error: message });
    }
  });

  r.delete('/templates/:id', async (req: Request, res: Response) => {
    const svc = await getTemplateService();
    if (!svc) {
      res.status(503).json({ error: 'Templates unavailable' });
      return;
    }
    try {
      const ok = await svc.delete(String(req.params.id));
      if (!ok) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return r;
}
