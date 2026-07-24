import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { getTemplateService } from '../../templates/global-manager.js';

/**
 * List document templates in the Template Library.
 */
export async function templateList(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const svc = getTemplateService();
  if (!svc) {
    return {
      success: false,
      output: 'Template library unavailable.',
      error: 'TEMPLATES_UNAVAILABLE',
    };
  }
  const q = typeof args['query'] === 'string' ? args['query'].trim().toLowerCase() : '';
  try {
    let templates = await svc.list();
    if (q) {
      templates = templates.filter((t) => {
        const hay = `${t.name} ${t.description ?? ''} ${t.designSummary ?? ''} ${t.tags.join(' ')}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (templates.length === 0) {
      return {
        success: true,
        output: q
          ? `No templates matched “${q}”.`
          : 'No templates yet. Ask the user to upload a PDF/Word/Excel design master under Knowledge Base → Templates.',
      };
    }
    const lines = templates.map((t) => {
      const analysis = t.analysisStatus !== 'ready' ? ` analysis=${t.analysisStatus}` : '';
      const slots = t.fields.length
        ? ` slots=[${t.fields.map((f) => f.key).join(', ')}]`
        : t.analysisStatus === 'analyzing' || t.analysisStatus === 'pending'
          ? ' slots=(analyzing design…)'
          : t.fillable
            ? ' slots=(none mapped yet — call template_inspect / re-analyze)'
            : ' (reference only — cannot auto-generate)';
      const brief = t.designSummary
        ? ` · ${t.designSummary.slice(0, 120)}${t.designSummary.length > 120 ? '…' : ''}`
        : '';
      return `- id=${t.id} · ${t.name} · ${t.format}${analysis}${slots}${brief}`;
    });
    return {
      success: true,
      output: [
        `Template library (${templates.length}):`,
        lines.join('\n'),
        '',
        'Use template_inspect to understand the design, then template_fill to clone it with available data.',
        'Output must look exactly like the master (same format/layout). Missing slot data stays blank; extra data is ignored. Never rebuild the document from scratch.',
      ].join('\n'),
      metadata: { count: templates.length, ids: templates.map((t) => t.id) },
    };
  } catch (e) {
    return {
      success: false,
      output: e instanceof Error ? e.message : String(e),
      error: 'TEMPLATE_LIST_FAILED',
    };
  }
}

/**
 * Inspect a template (design brief, content slots, generate readiness).
 */
export async function templateInspect(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  const svc = getTemplateService();
  if (!svc) {
    return { success: false, output: 'Template library unavailable.', error: 'TEMPLATES_UNAVAILABLE' };
  }
  const templateId = typeof args['templateId'] === 'string' ? args['templateId'].trim() : '';
  if (!templateId) {
    return { success: false, output: 'templateId is required', error: 'INVALID_ARGS' };
  }
  try {
    const t = await svc.get(templateId);
    if (!t) {
      return { success: false, output: `Template not found: ${templateId}`, error: 'NOT_FOUND' };
    }
    const fieldLines = t.fields.length
      ? t.fields.map((f) => {
        const sample = f.sampleValue ? ` sample="${f.sampleValue}"` : '';
        return `  - {{${f.key}}} — ${f.label}${sample}`;
      }).join('\n')
      : '  (none)';
    return {
      success: true,
      output: [
        `Template: ${t.name}`,
        `id: ${t.id}`,
        `format: ${t.format}`,
        `generatable: ${t.fillable}`,
        `analysis: ${t.analysisStatus}${t.analysisError ? ` (${t.analysisError})` : ''}`,
        `storageId: ${t.storageId}`,
        t.description ? `description: ${t.description}` : null,
        t.designSummary ? `design:\n${t.designSummary}` : 'design: (not analyzed yet)',
        `content slots:\n${fieldLines}`,
        t.analysisStatus === 'analyzing' || t.analysisStatus === 'pending'
          ? 'Design analysis still running — wait, then inspect again.'
          : t.fillable
            ? 'Next: call template_fill with whatever slot values you have. Missing slots stay blank; unused data is ignored. Output clones this design in the same format.'
            : 'This file could not be prepared for generation. Prefer PDF, Word (.docx), or Excel (.xlsx).',
      ].filter(Boolean).join('\n'),
      metadata: {
        templateId: t.id,
        storageId: t.storageId,
        fillable: t.fillable,
        analysisStatus: t.analysisStatus,
        designSummary: t.designSummary,
        fields: t.fields.map((f) => f.key),
      },
    };
  } catch (e) {
    return {
      success: false,
      output: e instanceof Error ? e.message : String(e),
      error: 'TEMPLATE_INSPECT_FAILED',
    };
  }
}

/**
 * Clone a template with available data and save a new attachment (layout preserved).
 */
export async function templateFill(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const svc = getTemplateService();
  if (!svc) {
    return { success: false, output: 'Template library unavailable.', error: 'TEMPLATES_UNAVAILABLE' };
  }
  const templateId = typeof args['templateId'] === 'string' ? args['templateId'].trim() : '';
  if (!templateId) {
    return { success: false, output: 'templateId is required', error: 'INVALID_ARGS' };
  }
  const rawValues = args['values'];
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    return {
      success: false,
      output: 'values must be an object of { slotKey: stringValue }. Omit or leave empty any slots without data.',
      error: 'INVALID_ARGS',
    };
  }
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawValues as Record<string, unknown>)) {
    values[k] = v == null ? '' : String(v);
  }
  const outputName = typeof args['outputName'] === 'string' ? args['outputName'] : undefined;
  try {
    const result = await svc.fill(templateId, {
      values,
      outputName,
      sessionId: context.sessionId,
    });
    const blank = result.missingFields.length
      ? `\nSlots left blank (no data): ${result.missingFields.join(', ')}`
      : '';
    return {
      success: true,
      output: [
        `Generated “${result.templateName}” → ${result.outputName}`,
        `storageId: ${result.storageId}`,
        result.path ? `path: ${result.path}` : null,
        'Output clones the template design — same format, layout, fonts, colors, and images.',
        'Share the file with the user (path or attachment). Do not recreate the document from scratch.',
        blank || null,
      ].filter(Boolean).join('\n'),
      metadata: {
        templateId: result.templateId,
        storageId: result.storageId,
        path: result.path,
        outputName: result.outputName,
        missingFields: result.missingFields,
      },
    };
  } catch (e) {
    return {
      success: false,
      output: e instanceof Error ? e.message : String(e),
      error: 'TEMPLATE_FILL_FAILED',
    };
  }
}
