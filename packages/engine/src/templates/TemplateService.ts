import { basename } from 'node:path';
import type { Pool } from 'pg';
import type {
  DocumentTemplate,
  TemplateFillRequest,
  TemplateFillResult,
  UpdateDocumentTemplateInput,
} from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';
import { TemplateStore } from './TemplateStore.js';
import { detectTemplateFormat, isFillableFormat } from './placeholder-scan.js';
import { analyzeTemplateDesign } from './field-discover.js';
import { instrumentTemplateBuffer } from './template-instrument.js';
import { locatePdfFieldTargets } from './pdf-fill.js';
import { fillTemplateBuffer } from './template-fill.js';

export interface TemplateServiceOptions {
  pool: Pool;
}

export class TemplateService {
  private store: TemplateStore;
  private logger = getLogger();
  private analyzing = new Set<string>();

  constructor(opts: TemplateServiceOptions) {
    this.store = new TemplateStore(opts.pool);
  }

  async list(): Promise<DocumentTemplate[]> {
    return this.store.list();
  }

  async get(id: string): Promise<DocumentTemplate | null> {
    return this.store.get(id);
  }

  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<DocumentTemplate> {
    const name = basename(filename).trim() || 'template';
    const format = detectTemplateFormat(name, mimeType);
    const fillable = isFillableFormat(format);

    const attachment = await getAttachmentService().saveFromBuffer(
      'templates',
      name,
      buffer,
      mimeType || 'application/octet-stream',
      'upload',
    );

    const template = await this.store.insert({
      name,
      mimeType: attachment.mimeType || mimeType,
      size: buffer.length,
      storageId: attachment.id,
      format,
      fillable,
      fields: [],
      designSummary: null,
      tags: [],
      analysisStatus: 'analyzing',
    });

    // Background: understand design → map content slots → instrument master.
    void this.analyzeTemplate(template.id);
    return template;
  }

  async update(id: string, patch: UpdateDocumentTemplateInput): Promise<DocumentTemplate | null> {
    return this.store.update(id, patch);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.store.get(id);
    if (!existing) return false;
    const ok = await this.store.delete(id);
    if (ok) {
      try {
        await getAttachmentService().deleteAttachment(existing.storageId);
      } catch {
        /* best-effort */
      }
    }
    return ok;
  }

  /** Re-run design analysis + slot instrumentation. */
  async rescanFields(id: string): Promise<DocumentTemplate | null> {
    const existing = await this.store.get(id);
    if (!existing) return null;
    await this.store.update(id, {
      analysisStatus: 'analyzing',
      analysisError: null,
      fields: [],
      designSummary: null,
    });
    await this.analyzeTemplate(id);
    return this.store.get(id);
  }

  async analyzeTemplate(id: string): Promise<DocumentTemplate | null> {
    if (this.analyzing.has(id)) return this.store.get(id);
    this.analyzing.add(id);
    try {
      const existing = await this.store.get(id);
      if (!existing) return null;
      await this.store.update(id, { analysisStatus: 'analyzing', analysisError: null });

      const buffer = await getAttachmentService().getBuffer(existing.storageId);
      if (!buffer) {
        return this.store.update(id, {
          analysisStatus: 'failed',
          analysisError: 'Template file missing from storage',
          fillable: false,
        });
      }

      const analysis = await analyzeTemplateDesign(buffer, existing.format, existing.name);
      let fields = analysis.fields;
      const designSummary = analysis.designSummary || null;

      let nextBuffer = buffer;
      let storageId = existing.storageId;
      let size = existing.size;

      if (existing.format === 'docx' || existing.format === 'xlsx') {
        nextBuffer = await instrumentTemplateBuffer(buffer, existing.format, fields);
        if (!nextBuffer.equals(buffer)) {
          const stored = await getAttachmentService().saveFromBuffer(
            'templates',
            existing.name,
            nextBuffer,
            existing.mimeType,
            'tool',
          );
          try {
            await getAttachmentService().deleteAttachment(existing.storageId);
          } catch {
            /* keep old if delete fails */
          }
          storageId = stored.id;
          size = nextBuffer.length;
          // After instrumentation, placeholders are the generate path
          fields = fields.map((f) =>
            f.source === 'placeholder' ? f : { ...f, source: 'placeholder' as const },
          );
        }
      } else if (existing.format === 'pdf') {
        fields = await locatePdfFieldTargets(buffer, fields);
      }

      const fillable = isFillableFormat(existing.format) && (
        fields.length > 0
        || existing.format === 'docx'
        || existing.format === 'xlsx'
      );

      return this.store.update(id, {
        fields,
        designSummary,
        fillable,
        storageId,
        size,
        analysisStatus: 'ready',
        analysisError: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('TEMPLATES', `Analysis failed for ${id}: ${message}`);
      return this.store.update(id, {
        analysisStatus: 'failed',
        analysisError: message,
      });
    } finally {
      this.analyzing.delete(id);
    }
  }

  /**
   * Generate a new document that clones this template's design/format.
   * Provided slot values are applied; missing slots stay blank; extra keys ignored.
   */
  async fill(id: string, request: TemplateFillRequest): Promise<TemplateFillResult> {
    const template = await this.store.get(id);
    if (!template) throw new Error('Template not found');
    if (template.analysisStatus === 'analyzing' || template.analysisStatus === 'pending') {
      throw new Error(`“${template.name}” is still analyzing its design. Try again in a moment.`);
    }
    if (!isFillableFormat(template.format)) {
      throw new Error(
        `“${template.name}” (${template.format}) cannot be generated from automatically. Prefer PDF, Word (.docx), or Excel (.xlsx).`,
      );
    }

    const buffer = await getAttachmentService().getBuffer(template.storageId);
    if (!buffer) throw new Error('Template file missing from storage');

    // Start from known slots as blank so sample/demo text is cleared when not provided.
    const values: Record<string, string> = {};
    for (const f of template.fields) {
      values[f.key] = '';
    }
    for (const [k, v] of Object.entries(request.values ?? {})) {
      if (typeof k === 'string' && k.trim()) values[k.trim()] = v == null ? '' : String(v);
    }

    const missingFields = template.fields
      .map((f) => f.key)
      .filter((key) => !String(values[key] ?? '').trim());

    const filled = await fillTemplateBuffer(buffer, template.format, values, template.fields);
    const ext = template.format === 'xlsx' ? 'xlsx' : template.format === 'pdf' ? 'pdf' : 'docx';
    const base = template.name.replace(/\.[^.]+$/, '');
    const outputName = (request.outputName?.trim() || `${base}-filled.${ext}`).replace(/[^\w.\- ()[\]]+/g, '_');

    const mime = template.format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : template.format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    const stored = await getAttachmentService().saveFromBuffer(
      request.sessionId ?? 'templates',
      outputName,
      filled,
      mime,
      'tool',
    );
    const path = await getAttachmentService().resolveAttachmentPath(stored.id) ?? undefined;

    return {
      templateId: template.id,
      templateName: template.name,
      outputName: stored.filename || outputName,
      mimeType: stored.mimeType || mime,
      storageId: stored.id,
      path,
      missingFields,
    };
  }
}
