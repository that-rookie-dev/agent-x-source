import { Router } from 'express';
import { basename } from 'node:path';
import { getAttachmentService } from '@agentx/engine';
import { getLogger, isPathInsideRoot } from '@agentx/shared';
import { getActiveWorkspacePath } from '../../workspace.js';

export function createAttachmentsRouter(): Router {
  const r = Router();
  const service = getAttachmentService();

  /** Register a workspace file for preview/download (idempotent by absolute path). */
  r.post('/api/attachments/register-workspace', async (req, res) => {
    try {
      const { originalPath, filename, mimeType, sessionId } = req.body as {
        originalPath?: string;
        filename?: string;
        mimeType?: string;
        sessionId?: string;
      };
      if (!originalPath || typeof originalPath !== 'string') {
        res.status(422).json({ error: 'originalPath is required' });
        return;
      }
      const workspaceRoot = getActiveWorkspacePath();
      if (!isPathInsideRoot(originalPath, workspaceRoot)) {
        res.status(403).json({ error: 'Path is outside the active workspace' });
        return;
      }
      const existing = (
        service as typeof service & {
          findByOriginalPath?: (path: string) => ReturnType<typeof service.getAttachment>;
        }
      ).findByOriginalPath?.(originalPath);
      if (existing) {
        res.json({ ok: true, attachment: existing });
        return;
      }
      const attachment = await service.registerAttachment({
        sessionId: sessionId || 'preview',
        filename: filename || basename(originalPath),
        mimeType,
        source: 'workspace',
        originalPath,
      });
      res.json({ ok: true, attachment });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      getLogger().error('ATTACHMENT_REGISTER_WORKSPACE', message);
      res.status(400).json({ error: message });
    }
  });

  r.post('/api/sessions/:sessionId/attachments', async (req, res) => {
    try {
      const sessionId = req.params.sessionId;
      const { filename, dataUrl, source = 'upload' } = req.body as {
        filename: string;
        dataUrl: string;
        source?: 'upload' | 'gmail' | 'tool';
      };
      if (!filename || !dataUrl) {
        res.status(422).json({ error: 'filename and dataUrl required' });
        return;
      }
      const attachment = await service.saveFromDataUrl(sessionId, filename, dataUrl, source);
      res.json({ ok: true, attachment });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      getLogger().error('ATTACHMENT_UPLOAD', message);
      res.status(400).json({ error: message });
    }
  });

  r.get('/api/attachments/:id', async (req, res) => {
    try {
      const attachment = service.getAttachment(req.params.id);
      if (!attachment) {
        res.status(404).json({ error: 'attachment not found' });
        return;
      }
      const available = await service.exists(attachment.id);
      if (req.query.meta === '1' || req.query.meta === 'true') {
        res.json({ ok: true, available, attachment });
        return;
      }
      if (!available) {
        res.status(410).json({ error: 'removed', message: 'File has been removed or is no longer accessible' });
        return;
      }
      const buffer = await service.getBuffer(attachment.id);
      if (!buffer) {
        res.status(410).json({ error: 'removed', message: 'File has been removed or is no longer accessible' });
        return;
      }
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('Content-Length', buffer.length.toString());
      res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
      res.end(buffer);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      getLogger().error('ATTACHMENT_DOWNLOAD', message);
      res.status(500).json({ error: message });
    }
  });

  r.get('/api/attachments/:id/preview', async (req, res) => {
    try {
      const preview = await service.extractPreview(req.params.id);
      res.json({ ok: true, preview });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      getLogger().error('ATTACHMENT_PREVIEW', message);
      res.status(500).json({ error: message });
    }
  });

  r.delete('/api/attachments/:id', async (req, res) => {
    try {
      await service.deleteAttachment(req.params.id);
      res.json({ ok: true });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      getLogger().error('ATTACHMENT_DELETE', message);
      res.status(500).json({ error: message });
    }
  });

  return r;
}
