import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import type { TemplateField, TemplateFormat } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { ConfigManager } from '../config/ConfigManager.js';
import { createAiSdkModel } from '../agent/AiSdkBridge.js';
import { extractJsonObject } from '../agent/task-executor-helpers.js';
import { extractFromPath } from '../attachments/extract.js';
import { fieldsFromKeys, scanTemplatePlaceholders } from './placeholder-scan.js';

const MAX_TEXT_CHARS = 24_000;

export async function extractTemplatePlainText(
  buffer: Buffer,
  format: TemplateFormat,
  filename: string,
): Promise<string> {
  if (format === 'docx' || format === 'xlsx' || format === 'pptx' || format === 'pdf') {
    const tmp = join(tmpdir(), `tpl-extract-${randomUUID()}-${basenameSafe(filename)}`);
    try {
      await writeFile(tmp, buffer);
      const mime = mimeForFormat(format);
      const preview = await extractFromPath(tmp, mime);
      if (preview.kind === 'text') return preview.content ?? '';
      if (preview.kind === 'table') {
        const header = (preview.headers ?? []).join('\t');
        const rows = (preview.rows ?? []).map((r) => r.join('\t')).join('\n');
        return [header, rows].filter(Boolean).join('\n');
      }
      return '';
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }
  // Best-effort for unknown / legacy .doc: treat as latin1 text scrape.
  if (format === 'doc' || format === 'other') {
    const asText = buffer.toString('utf8').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ' ');
    return asText.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
  }
  return '';
}

function basenameSafe(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'file';
}

function mimeForFormat(format: TemplateFormat): string {
  switch (format) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

interface LlmSlotRow {
  key?: unknown;
  label?: unknown;
  example?: unknown;
  context?: unknown;
  blankToken?: unknown;
  sampleValue?: unknown;
}

export interface TemplateDesignAnalysis {
  designSummary: string;
  fields: TemplateField[];
}

/**
 * Ask the chat model to understand the template *design* and list variable
 * content slots (including sample/example text already present).
 * This is NOT "find empty gaps" — the goal is to reproduce the same layout
 * with new data, leaving unavailable slots blank.
 */
export async function analyzeTemplateDesignWithLlm(
  plainText: string,
  format: TemplateFormat,
  filename: string,
): Promise<TemplateDesignAnalysis> {
  const text = plainText.trim().slice(0, MAX_TEXT_CHARS);
  if (!text) {
    return { designSummary: '', fields: [] };
  }

  let cfg;
  try {
    cfg = new ConfigManager().load();
  } catch {
    getLogger().warn('TEMPLATES', 'Design analysis skipped — agent config not available');
    return { designSummary: '', fields: [] };
  }

  let model;
  try {
    model = createAiSdkModel(cfg);
  } catch (err) {
    getLogger().warn(
      'TEMPLATES',
      `Design analysis model unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { designSummary: '', fields: [] };
  }

  const prompt = `You analyze a document TEMPLATE so another system can clone its exact design.

File: ${filename}
Format: ${format}

Extracted text (may be imperfect OCR/extraction):
"""
${text}
"""

GOAL
Reproduce a new document that LOOKS EXACTLY like this template (same layout, sections, labels, tables, styling intent), in the same file format. Variable content is substituted from available data; missing data stays blank; extra data is ignored. Do NOT hunt for "empty gaps" as the primary strategy — understand the design.

TASKS
1) Describe the design briefly: document type/purpose, page structure, major sections, tables, logos/headers/footers, fixed legal or chrome text that must never change.
2) List every VARIABLE content slot — places whose text/value changes between instances of this document:
   - Sample/example/demo values already filled in (e.g. "John Doe", "Acme Corp", "01/01/2024", "$1,000") — these ARE slots; capture them as sampleValue exactly as they appear
   - Underscore/dot leaders, bracket hints ([Name], <date>), empty values after labels
   - Empty or sample table cells meant for instance data
   - Signature / date / amount / address / party-name / invoice-number style regions
3) Do NOT invent slots for fixed design chrome (company letterhead that is part of the brand master, section titles that are structural, page numbers, decorative lines) unless that text is clearly instance-specific sample data.
4) Prefer exact sampleValue strings copied from the text so the system can locate and replace them in the binary.

Return ONLY JSON:
{
  "designSummary": "2-6 sentences: what this template is and how it is laid out; fixed vs variable parts.",
  "slots": [
    {
      "key": "snake_case_key",
      "label": "Human Label",
      "context": "nearby label or section name",
      "sampleValue": "exact sample text from the file, or empty string if the slot is blank",
      "blankToken": "____ or empty if not applicable",
      "example": "optional hint for a good real value"
    }
  ]
}`;

  try {
    const { text: out } = await generateText({
      model,
      prompt,
      maxOutputTokens: 3072,
      temperature: 0.1,
    });
    const parsed = extractJsonObject<{
      designSummary?: unknown;
      slots?: LlmSlotRow[];
      fields?: LlmSlotRow[];
    }>(out);
    const designSummary = typeof parsed?.designSummary === 'string'
      ? parsed.designSummary.trim()
      : '';
    const rows = Array.isArray(parsed?.slots)
      ? parsed!.slots!
      : Array.isArray(parsed?.fields)
        ? parsed!.fields!
        : [];
    const fields: TemplateField[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = typeof row.key === 'string'
        ? row.key.trim().toLowerCase().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
        : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const label = typeof row.label === 'string' && row.label.trim()
        ? row.label.trim()
        : key;
      const field: TemplateField = {
        key,
        label,
        required: false,
        source: 'llm',
      };
      if (typeof row.example === 'string' && row.example.trim()) field.example = row.example.trim();
      if (typeof row.context === 'string' && row.context.trim()) field.context = row.context.trim();
      if (typeof row.blankToken === 'string' && row.blankToken.trim()) {
        field.blankToken = row.blankToken;
      }
      if (typeof row.sampleValue === 'string' && row.sampleValue.trim()) {
        field.sampleValue = row.sampleValue.trim();
      }
      fields.push(field);
    }
    return { designSummary, fields };
  } catch (err) {
    getLogger().warn(
      'TEMPLATES',
      `LLM design analysis failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { designSummary: '', fields: [] };
  }
}

/** @deprecated Prefer analyzeTemplateDesignWithLlm — kept for call-site compatibility. */
export async function discoverFieldsWithLlm(
  plainText: string,
  format: TemplateFormat,
  filename: string,
): Promise<TemplateField[]> {
  const { fields } = await analyzeTemplateDesignWithLlm(plainText, format, filename);
  return fields;
}

/**
 * Merge explicit {{placeholders}} with LLM design slots (placeholders win on key clash).
 */
export async function analyzeTemplateDesign(
  buffer: Buffer,
  format: TemplateFormat,
  filename: string,
): Promise<TemplateDesignAnalysis> {
  const fromPlaceholders = (await scanTemplatePlaceholders(buffer, format)).map((f) => ({
    ...f,
    required: false,
    source: 'placeholder' as const,
  }));

  let plain = '';
  try {
    plain = await extractTemplatePlainText(buffer, format, filename);
  } catch (err) {
    getLogger().warn(
      'TEMPLATES',
      `Text extract failed for ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const llm = await analyzeTemplateDesignWithLlm(plain, format, filename);
  const byKey = new Map<string, TemplateField>();
  for (const f of llm.fields) byKey.set(f.key, f);
  for (const f of fromPlaceholders) byKey.set(f.key, f); // placeholders override
  let fields = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));

  // Fallback: underscore leaders only when LLM found nothing.
  if (fields.length === 0 && /_{3,}|\.{3,}/.test(plain)) {
    const keys = [...plain.matchAll(/_{3,}|\.{3,}/g)].map((_, i) => `field_${i + 1}`);
    fields = fieldsFromKeys(keys).map((f) => ({
      ...f,
      required: false,
      source: 'llm' as const,
      blankToken: '____',
    }));
  }

  const designSummary = llm.designSummary
    || (fields.length > 0
      ? `Master ${format.toUpperCase()} template with ${fields.length} variable content slot(s). Output must clone this design; unavailable slots stay blank.`
      : '');

  return { designSummary, fields };
}

/** @deprecated Prefer analyzeTemplateDesign. */
export async function discoverTemplateFields(
  buffer: Buffer,
  format: TemplateFormat,
  filename: string,
): Promise<TemplateField[]> {
  const { fields } = await analyzeTemplateDesign(buffer, format, filename);
  return fields;
}
