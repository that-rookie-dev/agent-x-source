/**
 * Document Studio — fill_clone compose adapter for DOCX/XLSX (spec §6.2).
 *
 * Wraps the existing template-fill binary path, driven by Document Studio
 * variables. Missing values stay blank; extra keys are ignored; the binary
 * layout is cloned, not rebuilt.
 */

import { getAttachmentService } from '../../attachments/index.js';
import { fillTemplateBuffer } from '../../templates/template-fill.js';
import type { TemplateField } from '@agentx/shared';
import type { Master } from '../types.js';
import type { ComposeInput, ComposeOutput } from '../runner/PrimitiveRegistry.js';

export function variablesToFields(master: Master): TemplateField[] {
  const vars = master.analysis?.variables ?? [];
  return vars.map((v) => {
    const isExplicit = ['placeholder', 'bookmark', 'content_control', 'table_cell', 'sheet_cell'].includes(
      v.locator?.type ?? '',
    );
    const field: TemplateField & { adapterHints?: Record<string, unknown> } = {
      key: v.key,
      label: v.label,
      required: v.required,
      source: isExplicit ? ('placeholder' as const) : ('llm' as const),
      sampleValue: v.sampleValue,
      example: v.sampleValue,
    };

    const loc = v.locator;
    if (loc?.type === 'pdf_region') {
      field.page = loc.page;
      field.x = loc.x;
      field.y = loc.y;
      field.width = loc.width;
      field.fontSize = loc.fontSize;
    } else if (loc && loc.type !== 'placeholder' && loc.type !== 'sample_text') {
      field.adapterHints = loc as unknown as Record<string, unknown>;
    }

    return field as unknown as TemplateField;
  }) as unknown as TemplateField[];
}

export async function composeFillClone(input: ComposeInput & { workspaceRoot: string; jobId?: string }): Promise<ComposeOutput> {
  const master = input.master;
  const bindingSet = input.bindingSet;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(bindingSet?.values ?? {})) {
    values[k] = v == null ? '' : String(v);
  }

  const fields = variablesToFields(master);
  const valueKeys = new Set(Object.keys(values));
  for (const v of master.analysis?.variables ?? []) {
    if (!valueKeys.has(v.key)) values[v.key] = '';
  }

  const warnings: string[] = [];
  for (const v of master.analysis?.variables ?? []) {
    if (!v.locator) continue;
    const loc = v.locator;
    if (['bookmark', 'content_control', 'table_cell'].includes(loc.type) && master.format !== 'docx') {
      warnings.push(`${loc.type} locator for "${v.key}" is only supported for DOCX masters`);
    }
    if (loc.type === 'sheet_cell' && master.format !== 'xlsx') {
      warnings.push(`sheet_cell locator for "${v.key}" is only supported for XLSX masters`);
    }
    if (loc.type === 'pdf_region' && master.format !== 'pdf') {
      warnings.push(`pdf_region locator for "${v.key}" is only supported for PDF masters; falling back to sample/placeholder fill`);
    }
  }

  const buffer = await getAttachmentService().getBuffer(master.storageId);
  if (!buffer) throw new Error('Master file missing from storage');
  const filled = await fillTemplateBuffer(buffer, master.format as 'docx' | 'xlsx' | 'pdf' | 'other', values, fields);
  return { bytes: new Uint8Array(filled), format: master.format, warnings };
}

export function supportsFillClone(master: Master): boolean {
  return master.format === 'docx' || master.format === 'xlsx' || master.format === 'pdf';
}
