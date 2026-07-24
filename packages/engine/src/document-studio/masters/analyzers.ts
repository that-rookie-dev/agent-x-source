/**
 * Document Studio — kind-specific master analysis (spec §6.1).
 *
 * Honest-analysis rules (I3/I4):
 *  - Model unavailable → outcome `awaiting_model`, never heuristic READY.
 *  - Fill variables only get locators we can actually resolve
 *    (explicit {{placeholder}} or exact sample text present in the file);
 *    otherwise `locator: null` and the variable is not fillable.
 *  - Data masters are profiled deterministically (no model required).
 */

import { generateText } from 'ai';
import JSZip from 'jszip';
import { getLogger } from '@agentx/shared';
import { ConfigManager } from '../../config/ConfigManager.js';
import { createAiSdkModel, modelSupportsVision } from '../../agent/AiSdkBridge.js';
import { extractJsonObject } from '../../agent/task-executor-helpers.js';
import { extractTemplatePlainText } from '../../templates/field-discover.js';
import {
  extractPlaceholderKeys,
  fieldsFromKeys,
  scanTemplatePlaceholders,
} from '../../templates/placeholder-scan.js';
import { locatePdfFieldTargets } from '../../templates/pdf-fill.js';
import { renderPdfPagesToPng, type RenderedPdfPage } from '../../templates/pdf-render.js';
import { extractPdfGridVariables, type PdfGridTable } from './pdf-grid.js';
import type { TemplateField, TemplateFormat } from '@agentx/shared';
import type {
  AnalysisPackage,
  AnalysisState,
  ColumnProfile,
  Constraint,
  LayoutMap,
  LayoutRegion,
  LayoutTableGrid,
  MasterFormat,
  MasterKind,
  SectionOutline,
  Sensitivity,
  TableOutline,
  Variable,
  VariableDatatype,
} from '../types.js';

const MAX_TEXT_CHARS = 24_000;

export interface AnalyzeOutcome {
  state: Extract<AnalysisState, 'ready' | 'partial' | 'awaiting_model' | 'failed'>;
  analysis: AnalysisPackage | null;
  error?: string;
}

function toTemplateFormat(format: MasterFormat): TemplateFormat {
  if (format === 'csv' || format === 'md') return 'other';
  return format as TemplateFormat;
}

async function extractText(buffer: Buffer, format: MasterFormat, name: string): Promise<string> {
  if (format === 'csv' || format === 'md') return buffer.toString('utf8').slice(0, MAX_TEXT_CHARS);
  return (await extractTemplatePlainText(buffer, toTemplateFormat(format), name)).slice(0, MAX_TEXT_CHARS);
}

export type Model = ReturnType<typeof createAiSdkModel>;

export function tryCreateModel(): Model | null {
  try {
    return createAiSdkModel(new ConfigManager().load());
  } catch (err) {
    getLogger().warn('DOC_STUDIO', `Analysis model unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Data master (deterministic — no model) ────────────────────────────────

/** Minimal RFC4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string, maxRows = 5000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

const PII_TOKENS = new Set(['ssn', 'social', 'security', 'sin', 'dob', 'birth', 'birthdate', 'dateofbirth', 'pan', 'tin', 'tax', 'taxpayer', 'nationalid', 'passport', 'aadhaar', 'pf', 'esi']);
const FINANCIAL_TOKENS = new Set(['salary', 'salaries', 'income', 'wage', 'wages', 'bank', 'account', 'acc', 'routing', 'iban', 'swift', 'creditcard', 'card', 'pay', 'payment', 'payments', 'netpay', 'gross', 'deduction', 'deductions', 'compensation', 'remuneration']);

function inferHeaderSensitivity(name: string): Sensitivity | undefined {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((t) => PII_TOKENS.has(t))) return 'pii';
  if (tokens.some((t) => FINANCIAL_TOKENS.has(t))) return 'financial';
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (PII_TOKENS.has(normalized)) return 'pii';
  for (const t of FINANCIAL_TOKENS) if (normalized.includes(t)) return 'financial';
  return undefined;
}

export function profileColumn(name: string, values: string[]): ColumnProfile {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  const nullable = nonEmpty.length < values.length;
  let datatype: ColumnProfile['datatype'] = 'unknown';
  if (nonEmpty.length > 0) {
    if (nonEmpty.every((v) => /^-?[\d,]+(\.\d+)?$/.test(v.trim()))) datatype = 'number';
    else if (nonEmpty.every((v) => /^(true|false|yes|no)$/i.test(v.trim()))) datatype = 'boolean';
    else if (nonEmpty.every((v) => !Number.isNaN(Date.parse(v)) && /[-/.]/.test(v))) datatype = 'date';
    else datatype = 'string';
  }
  const distinct = [...new Set(nonEmpty)].slice(0, 5);
  return { name, datatype, nullable, distinctSample: distinct, sensitivity: inferHeaderSensitivity(name) };
}

export function analyzeDataBuffer(buffer: Buffer, name: string): AnalyzeOutcome {
  const rows = parseCsv(buffer.toString('utf8'));
  if (rows.length === 0) {
    return { state: 'failed', analysis: null, error: 'Dataset is empty or unparseable' };
  }
  const headers = rows[0]!.map((h, i) => h.trim() || `column_${i + 1}`);
  const body = rows.slice(1);
  const columns = headers.map((h, i) => profileColumn(h, body.map((r) => r[i] ?? '')));
  const sampleRows = body.slice(0, 5).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  const warnings = body.length === 0 ? ['Dataset has headers but no rows'] : [];
  return {
    state: body.length === 0 ? 'partial' : 'ready',
    analysis: {
      kind: 'data',
      documentType: 'dataset',
      summary: `Dataset "${name}": ${body.length} rows × ${headers.length} columns (${headers.slice(0, 8).join(', ')}${headers.length > 8 ? ', …' : ''}).`,
      confidence: 1,
      warnings,
      dataProfile: { columns, rowCount: body.length, sampleRows },
    },
  };
}

// ─── Layout master (LLM + locator verification) ────────────────────────────

interface LlmLayoutRow {
  key?: unknown; label?: unknown; datatype?: unknown; required?: unknown;
  sampleValue?: unknown; context?: unknown; sensitivity?: unknown; description?: unknown;
}

interface LlmLayoutMap {
  pages?: unknown;
  regions?: unknown;
  tables?: unknown;
}

function snake(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') : '';
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Parse the LLM's layoutMap JSON into a typed LayoutMap (defensive). */
function parseLayoutMap(parsed: LlmLayoutMap | undefined, rendered: RenderedPdfPage[]): LayoutMap {
  const pages: LayoutMap['pages'] = (rendered.length > 0
    ? rendered
    : []).map((p) => ({ page: p.page, widthPt: p.widthPt, heightPt: p.heightPt, orientation: p.orientation }));

  const regions: LayoutRegion[] = [];
  if (Array.isArray(parsed?.regions)) {
    let i = 0;
    for (const r of parsed!.regions as Array<Record<string, unknown>>) {
      const page = typeof r?.['page'] === 'number' ? r['page'] : 1;
      const x = num(r?.['x']) ?? 0;
      const y = num(r?.['y']) ?? 0;
      const width = num(r?.['width']) ?? 0;
      const height = num(r?.['height']) ?? 0;
      if (width <= 0 || height <= 0) continue;
      const type = (['header', 'footer', 'title', 'label', 'value', 'table', 'table_cell', 'rule', 'note', 'other'] as const).includes(r?.['type'] as never)
        ? (r['type'] as LayoutRegion['type'])
        : 'other';
      regions.push({
        id: String(r?.['id'] ?? `r${++i}`),
        page,
        type,
        text: typeof r?.['text'] === 'string' ? r['text'] : undefined,
        x,
        y,
        width,
        height,
        role: typeof r?.['role'] === 'string' ? r['role'] : undefined,
      });
    }
  }

  const tables: LayoutTableGrid[] = [];
  if (Array.isArray(parsed?.tables)) {
    let i = 0;
    for (const t of parsed!.tables as Array<Record<string, unknown>>) {
      const page = typeof t?.['page'] === 'number' ? t['page'] : 1;
      const x = num(t?.['x']) ?? 0;
      const y = num(t?.['y']) ?? 0;
      const width = num(t?.['width']) ?? 0;
      const height = num(t?.['height']) ?? 0;
      const rows = Math.max(0, Math.floor(num(t?.['rows']) ?? 0));
      const cols = Math.max(0, Math.floor(num(t?.['cols']) ?? 0));
      if (rows === 0 || cols === 0 || width <= 0 || height <= 0) continue;
      const colX = Array.isArray(t?.['colX']) ? (t!['colX'] as unknown[]).map(num).filter((n): n is number => n !== undefined) : undefined;
      const rowY = Array.isArray(t?.['rowY']) ? (t!['rowY'] as unknown[]).map(num).filter((n): n is number => n !== undefined) : undefined;
      tables.push({
        id: String(t?.['id'] ?? `t${++i}`),
        page,
        x,
        y,
        width,
        height,
        rows,
        cols,
        rowLabels: Array.isArray(t?.['rowLabels']) ? (t!['rowLabels'] as unknown[]).map(String) : undefined,
        colHeaders: Array.isArray(t?.['colHeaders']) ? (t!['colHeaders'] as unknown[]).map(String) : undefined,
        colX,
        rowY,
      });
    }
  }

  return { pages, regions, tables, source: rendered.length > 0 ? 'vision' : 'text' };
}

/**
 * Render PDF pages and (if the active model supports vision) build the multimodal
 * message payload for the layout-analysis call. Returns the rendered pages (for
 * LayoutMap geometry) and either a `messages` array (vision) or null (text-only,
 * caller uses `prompt`). Best-effort: render failures degrade to text-only.
 */
async function prepareVisionPayload(
  buffer: Buffer,
  format: MasterFormat,
  textPrompt: string,
): Promise<{ rendered: RenderedPdfPage[]; messages: unknown[] | null; warnings: string[] }> {
  const warnings: string[] = [];
  if (format !== 'pdf') return { rendered: [], messages: null, warnings };

  let config: import('@agentx/shared').AgentXConfig;
  try {
    config = new ConfigManager().load();
  } catch {
    return { rendered: [], messages: null, warnings };
  }
  if (!modelSupportsVision(config)) return { rendered: [], messages: null, warnings };

  const render = await renderPdfPagesToPng(buffer, { dpi: 150, maxPages: 4, maxEdgePx: 2000 });
  warnings.push(...render.warnings);
  if (render.pages.length === 0) return { rendered: [], messages: null, warnings };

  const content: unknown[] = [{ type: 'text', text: textPrompt }];
  for (const p of render.pages) {
    content.push({ type: 'image', image: new Uint8Array(p.png.buffer, p.png.byteOffset, p.png.byteLength), mimeType: 'image/png' });
  }
  return { rendered: render.pages, messages: [{ role: 'user', content }], warnings };
}

/**
 * Merge grid-cell variables into the base variable set. Grid variables (from
 * dense-table extraction) have `askPolicy: 'derive'` and `pdf_region` locators.
 * Existing variables (from placeholders/LLM) take precedence by key — grid vars
 * with duplicate keys are skipped so user-named variables aren't overwritten.
 */
function mergeGridVariables(base: Variable[], grid: Variable[]): Variable[] {
  if (grid.length === 0) return base;
  const seen = new Set(base.map((v) => v.key));
  const merged = [...base];
  for (const v of grid) {
    if (seen.has(v.key)) continue;
    seen.add(v.key);
    merged.push(v);
  }
  return merged;
}

/** Convert detected grid tables to TableOutline for the analysis layout. */
function gridToTableOutlines(tables: PdfGridTable[]): TableOutline[] {
  return tables.map((t, i) => ({
    id: `grid${i + 1}`,
    page: t.page,
    rows: t.rowLabels.length,
    cols: t.colHeaders.length,
    headers: t.colHeaders,
  }));
}

export async function analyzeLayoutBuffer(
  buffer: Buffer,
  format: MasterFormat,
  name: string,
): Promise<AnalyzeOutcome> {
  const text = await extractText(buffer, format, name);
  if (!text.trim()) return { state: 'failed', analysis: null, error: 'No extractable text in master' };

  // Dense-table grid extraction (deterministic, no model needed). For filled PDF
  // forms with no blanks, this emits one pdf_region variable per data cell so
  // fill_clone has overlay targets. Runs before the model check so it's available
  // even when the model is unavailable.
  const gridResult = format === 'pdf'
    ? await extractPdfGridVariables(buffer).catch((err) => {
        const w = `PDF grid extraction failed: ${err instanceof Error ? err.message : String(err)}`;
        return { variables: [] as Variable[], tables: [] as PdfGridTable[], warnings: [w] };
      })
    : { variables: [] as Variable[], tables: [] as PdfGridTable[], warnings: [] as string[] };

  // Explicit {{placeholders}} are locatable without any model.
  const placeholderFields = await scanTemplatePlaceholders(buffer, toTemplateFormat(format)).catch(() => []);
  const placeholderVars: Variable[] = placeholderFields.map((f) => ({
    key: f.key,
    label: f.label ?? f.key,
    datatype: 'string',
    required: false,
    askPolicy: 'ask',
    locator: { type: 'placeholder', token: `{{${f.key}}}` },
    sensitivity: 'none',
  }));

  const model = tryCreateModel();
  if (!model) {
    // Honest state: placeholders + grid cells are usable → partial; nothing → awaiting_model.
    const hasGrid = gridResult.variables.length > 0;
    if (placeholderVars.length > 0 || hasGrid) {
      const baseVars = await enhanceLocators(buffer, format, placeholderVars, [...gridResult.warnings]);
      const variables = mergeGridVariables(baseVars, gridResult.variables);
      return {
        state: 'partial',
        analysis: {
          kind: 'layout',
          documentType: 'unknown',
          summary: `Layout master "${name}" (${format}). Model unavailable — explicit placeholders and/or detected grid cells mapped.`,
          confidence: 0.5,
          warnings: ['Analysis model unavailable; only explicit placeholders and grid cells were mapped.', ...gridResult.warnings],
          layout: { sections: [], tables: gridToTableOutlines(gridResult.tables), chrome: [] },
          variables,
        },
      };
    }
    return { state: 'awaiting_model', analysis: null, error: 'Analysis model unavailable' };
  }

  // Visual scanner: render PDF pages to PNG and, if the active model supports
  // vision, attach them as image content parts so the LLM sees the exact design.
  const vision = await prepareVisionPayload(buffer, format, '');
  const hasVision = vision.messages !== null;
  const visionNote = hasVision
    ? `\nYou are ALSO given rendered page image(s) of this PDF. Use them as the ground truth for the visual layout — page size, orientation, region positions, and table grid structure. Coordinates are in PDF points with origin at the BOTTOM-LEFT (y increases upward), matching the rendered images.`
    : '';

  const prompt = `You analyze a document LAYOUT MASTER so a system can clone its design and bind new values.

File: ${name}
Format: ${format}
${visionNote}

Extracted text (may be imperfect):
"""
${text}
"""

Return ONLY JSON:
{
  "documentType": "form | statement | letter | report | other",
  "summary": "2-5 sentences: purpose and layout; fixed vs variable parts.",
  "sections": [{"id": "s1", "title": "…", "level": 1}],
  "chrome": ["fixed header/footer/brand text that must never change"],
  "variables": [
    {
      "key": "snake_case_key",
      "label": "Human Label",
      "datatype": "string|number|date|boolean|enum|money|richtext",
      "required": true,
      "sampleValue": "EXACT text copied from the extract (empty string if the slot is blank)",
      "context": "nearby label or section",
      "sensitivity": "none|pii|financial|health"
    }
  ]${hasVision ? `,
  "layoutMap": {
    "regions": [
      {"id": "r1", "page": 1, "type": "header|footer|title|label|value|table|table_cell|rule|note|other", "text": "verbatim text", "x": 0, "y": 0, "width": 100, "height": 12, "role": "semantic_role"}
    ],
    "tables": [
      {"id": "t1", "page": 1, "x": 0, "y": 0, "width": 500, "height": 200, "rows": 12, "cols": 13, "rowLabels": ["BASIC", "HRA"], "colHeaders": ["APRIL", "MAY"], "colX": [40, 90, 140], "rowY": [700, 680, 660]}
    ]
  }` : ''}
}

Rules:
- Variables are instance-specific values (names, dates, amounts, ids) — NOT structural titles, letterhead, page numbers, or legal chrome.
- sampleValue MUST be copied verbatim from the extract when present; do not paraphrase.
- Do not invent variables you cannot point at.${hasVision ? `
- For layoutMap: report EVERY distinct visual region you can see, including rule lines (type "rule") and individual table cells (type "table_cell"). For tables, give the full bounding box, row/col counts, row labels, column headers, and the x-coordinates of column boundaries (colX, ascending) and y-coordinates of row boundaries (rowY, ascending). Coordinates are PDF points, origin bottom-left.` : ''}`;

  try {
    // Replace the empty text part in the vision payload with the full prompt.
    const visionMessages = hasVision && vision.messages
      ? [{ role: 'user' as const, content: [{ type: 'text' as const, text: prompt }, ...(vision.messages[0] as { content: unknown[] }).content.slice(1)] } as { role: 'user'; content: unknown[] }]
      : null;
    const out = visionMessages
      ? (await generateText({ model, messages: visionMessages as never, maxOutputTokens: 4096, temperature: 0.1 })).text
      : (await generateText({ model, prompt, maxOutputTokens: 3072, temperature: 0.1 })).text;
    const parsed = extractJsonObject<{
      documentType?: unknown; summary?: unknown; sections?: unknown; chrome?: unknown; variables?: LlmLayoutRow[]; layoutMap?: LlmLayoutMap;
    }>(out);

    const seen = new Set(placeholderVars.map((v) => v.key));
    const warnings: string[] = [...vision.warnings];
    const llmVars: Variable[] = [];
    for (const row of Array.isArray(parsed?.variables) ? parsed!.variables! : []) {
      const key = snake(row.key);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const sample = typeof row.sampleValue === 'string' ? row.sampleValue.trim() : '';
      // I3 — locate-or-don't-claim: only exact text present in the extract becomes a locator.
      const located = sample.length >= 1 && text.includes(sample);
      if (sample && !located) warnings.push(`Variable "${key}": sample text not found verbatim; left unlocated.`);
      llmVars.push({
        key,
        label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : key,
        datatype: (['string', 'number', 'date', 'boolean', 'enum', 'money', 'richtext'] as const).includes(row.datatype as never)
          ? (row.datatype as Variable['datatype'])
          : 'string',
        required: row.required === true,
        askPolicy: 'ask',
        locator: located
          ? { type: 'sample_text', text: sample, context: typeof row.context === 'string' ? row.context : undefined }
          : null,
        sensitivity: (['none', 'pii', 'financial', 'health'] as const).includes(row.sensitivity as never)
          ? (row.sensitivity as Variable['sensitivity'])
          : 'none',
        sampleValue: sample || undefined,
        description: typeof row.description === 'string' ? row.description : undefined,
      });
    }

    const sections: SectionOutline[] = Array.isArray(parsed?.sections)
      ? (parsed!.sections as Array<Record<string, unknown>>)
          .filter((s) => typeof s?.['title'] === 'string')
          .map((s, i) => ({ id: String(s['id'] ?? `s${i + 1}`), title: String(s['title']), level: Number(s['level'] ?? 1) }))
      : [];
    const baseVars = await enhanceLocators(buffer, format, [...placeholderVars, ...llmVars], warnings);
    const variables = mergeGridVariables(baseVars, gridResult.variables);
    const layoutMap = hasVision ? parseLayoutMap(parsed?.layoutMap, vision.rendered) : undefined;
    warnings.push(...gridResult.warnings);
    const unlocated = variables.filter((v) => v.locator === null).length;
    return {
      state: unlocated > 0 ? 'partial' : 'ready',
      analysis: {
        kind: 'layout',
        documentType: typeof parsed?.documentType === 'string' ? parsed.documentType : 'unknown',
        summary: typeof parsed?.summary === 'string' ? parsed.summary : `Layout master "${name}".`,
        confidence: unlocated > 0 ? 0.6 : 0.85,
        warnings,
        layout: {
          sections,
          tables: gridToTableOutlines(gridResult.tables),
          chrome: Array.isArray(parsed?.chrome) ? (parsed!.chrome as unknown[]).map(String) : [],
        },
        layoutMap,
        variables,
      },
    };
  } catch (err) {
    return { state: 'failed', analysis: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Locator enhancement ────────────────────────────────────────────────────

async function enhanceLocators(
  buffer: Buffer,
  format: MasterFormat,
  variables: Variable[],
  warnings: string[],
): Promise<Variable[]> {
  if (variables.length === 0) return variables;
  if (format === 'docx') return enhanceDocxLocators(buffer, variables);
  if (format === 'xlsx') return enhanceXlsxLocators(buffer, variables);
  if (format === 'pdf') return enhancePdfLocators(buffer, variables, warnings);
  return variables;
}

async function enhanceDocxLocators(buffer: Buffer, variables: Variable[]): Promise<Variable[]> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string') ?? '';

  const bookmarkMap = new Map<string, string>();
  for (const m of documentXml.matchAll(/<w:bookmarkStart[^>]*?w:name="([^"]+)"[^>]*?>/g)) {
    bookmarkMap.set(m[1]!, m[1]!);
  }
  for (const m of documentXml.matchAll(/<w:bookmarkStart[^>]*?w:name='([^']+)'[^>]*?>/g)) {
    bookmarkMap.set(m[1]!, m[1]!);
  }

  const contentControlMap = new Map<string, string>();
  for (const m of documentXml.matchAll(/<w:tag[^>]*?w:val="([^"]+)"[^>]*?>/g)) {
    contentControlMap.set(m[1]!, m[1]!);
  }
  for (const m of documentXml.matchAll(/<w:tag[^>]*?w:val='([^']+)'[^>]*?>/g)) {
    contentControlMap.set(m[1]!, m[1]!);
  }

  const tableCellMap = new Map<string, { tableId: string; row: number; col: number }>();
  const tables = documentXml.split('<w:tbl').slice(1);
  for (let tableIdx = 0; tableIdx < tables.length; tableIdx++) {
    const table = tables[tableIdx]!;
    const rows = table.split('<w:tr').slice(1);
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]!;
      const cells = row.split('<w:tc').slice(1);
      for (let colIdx = 0; colIdx < cells.length; colIdx++) {
        const cell = cells[colIdx]!;
        const text = [...cell.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
        if (text.trim()) {
          tableCellMap.set(text, { tableId: String(tableIdx + 1), row: rowIdx + 1, col: colIdx + 1 });
        }
      }
    }
  }

  const result: Variable[] = [...variables];
  for (let i = 0; i < result.length; i++) {
    const v = result[i]!;
    const sample = (v.sampleValue ?? '').trim();
    const token = v.locator?.type === 'placeholder' ? v.locator.token : `{{${v.key}}}`;

    for (const [name] of bookmarkMap) {
      if (name.toLowerCase() === v.key.toLowerCase() || (sample && name.toLowerCase() === sample.toLowerCase())) {
        result[i] = { ...v, locator: { type: 'bookmark', name } };
        break;
      }
    }

    if (result[i]!.locator?.type !== 'bookmark') {
      for (const [tag] of contentControlMap) {
        if (tag.toLowerCase() === v.key.toLowerCase() || (sample && tag.toLowerCase() === sample.toLowerCase())) {
          result[i] = { ...v, locator: { type: 'content_control', tag } };
          break;
        }
      }
    }

    if (result[i]!.locator?.type !== 'bookmark' && result[i]!.locator?.type !== 'content_control') {
      for (const [text, addr] of tableCellMap) {
        if (text.includes(token) || (sample && text.includes(sample))) {
          result[i] = { ...v, locator: { type: 'table_cell', ...addr } };
          break;
        }
      }
    }
  }
  return result;
}

async function enhanceXlsxLocators(buffer: Buffer, variables: Variable[]): Promise<Variable[]> {
  const Excel = (await import('exceljs')).default;
  const wb = new Excel.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const cellMap = new Map<string, { sheet: string; cell: string }>();
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        let text = '';
        if (typeof v === 'string') text = v;
        else if (v && typeof v === 'object' && 'richText' in v) {
          text = (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
        } else if (v && typeof v === 'object' && 'text' in v && typeof (v as { text: unknown }).text === 'string') {
          text = (v as { text: string }).text;
        }
        if (text) cellMap.set(text, { sheet: ws.name, cell: cell.address });
      });
    });
  }

  const result: Variable[] = [...variables];
  for (let i = 0; i < result.length; i++) {
    const v = result[i]!;
    const sample = (v.sampleValue ?? '').trim();
    const token = v.locator?.type === 'placeholder' ? v.locator.token : `{{${v.key}}}`;
    for (const [text, addr] of cellMap) {
      if (text.includes(token) || (sample && text.includes(sample))) {
        result[i] = { ...v, locator: { type: 'sheet_cell', ...addr } };
        break;
      }
    }
  }
  return result;
}

async function enhancePdfLocators(
  buffer: Buffer,
  variables: Variable[],
  warnings: string[],
): Promise<Variable[]> {
  const fields: TemplateField[] = variables
    .filter((v) => v.sampleValue || v.locator?.type === 'sample_text')
    .map((v) => ({
      key: v.key,
      label: v.label,
      sampleValue: v.sampleValue,
      context: v.locator?.type === 'sample_text' ? (v.locator as { context?: string }).context : undefined,
    }));
  if (fields.length === 0) return variables;

  try {
    const located = await locatePdfFieldTargets(buffer, fields);
    const locatedByKey = new Map(located.map((f) => [f.key, f]));
    return variables.map((v) => {
      const f = locatedByKey.get(v.key);
      if (!f || f.page == null) return v;
      return {
        ...v,
        locator: {
          type: 'pdf_region',
          page: f.page,
          x: f.x ?? 0,
          y: f.y ?? 0,
          width: f.width ?? 80,
          fontSize: f.fontSize,
        },
      };
    });
  } catch (err) {
    warnings.push(`PDF region detection failed: ${err instanceof Error ? err.message : String(err)}`);
    return variables;
  }
}

// ─── Standard / guideline master ────────────────────────────────────────────

export async function analyzeStandardBuffer(
  buffer: Buffer,
  format: MasterFormat,
  name: string,
): Promise<AnalyzeOutcome> {
  const text = await extractText(buffer, format, name);
  if (!text.trim()) return { state: 'failed', analysis: null, error: 'No extractable text in master' };
  const model = tryCreateModel();
  if (!model) return { state: 'awaiting_model', analysis: null, error: 'Analysis model unavailable' };

  const prompt = `You analyze a STANDARD / GUIDELINE document (e.g. SOP, ICH E3, playbook) that governs how other documents must be authored.

File: ${name}

Extracted text (may be truncated):
"""
${text}
"""

Return ONLY JSON:
{
  "documentType": "guideline",
  "summary": "2-5 sentences: what this standard governs.",
  "requiredSections": [{"id": "s1", "title": "…", "level": 1, "required": true}],
  "constraints": [{"id": "c1", "kind": "section_required|citation|rule|schema|consistency", "description": "…"}]
}`;

  try {
    const { text: out } = await generateText({ model, prompt, maxOutputTokens: 3072, temperature: 0.1 });
    const parsed = extractJsonObject<{ documentType?: unknown; summary?: unknown; requiredSections?: unknown; constraints?: unknown }>(out);
    const requiredSections: SectionOutline[] = Array.isArray(parsed?.requiredSections)
      ? (parsed!.requiredSections as Array<Record<string, unknown>>)
          .filter((s) => typeof s?.['title'] === 'string')
          .map((s, i) => ({ id: String(s['id'] ?? `s${i + 1}`), title: String(s['title']), level: Number(s['level'] ?? 1), required: s['required'] !== false }))
      : [];
    const constraints: Constraint[] = Array.isArray(parsed?.constraints)
      ? (parsed!.constraints as Array<Record<string, unknown>>)
          .filter((c) => typeof c?.['description'] === 'string')
          .map((c, i) => ({
            id: String(c['id'] ?? `c${i + 1}`),
            kind: (['section_required', 'citation', 'rule', 'schema', 'consistency'] as const).includes(c['kind'] as never)
              ? (c['kind'] as Constraint['kind'])
              : 'rule',
            description: String(c['description']),
          }))
      : [];
    if (requiredSections.length === 0 && constraints.length === 0) {
      return { state: 'partial', analysis: {
        kind: 'standard', documentType: 'guideline',
        summary: typeof parsed?.summary === 'string' ? parsed.summary : `Standard "${name}".`,
        confidence: 0.4, warnings: ['No sections or constraints extracted — verify this is a standard/guideline.'],
        requiredSections, constraints,
      } };
    }
    return { state: 'ready', analysis: {
      kind: 'standard', documentType: 'guideline',
      summary: typeof parsed?.summary === 'string' ? parsed.summary : `Standard "${name}".`,
      confidence: 0.8, warnings: [], requiredSections, constraints,
    } };
  } catch (err) {
    return { state: 'failed', analysis: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Prior artifact master ──────────────────────────────────────────────────

function inferDatatype(value: string): VariableDatatype {
  const v = value.trim();
  if (/^-?[\d,]+(\.\d+)?$/.test(v)) return 'number';
  if (/^(true|false|yes|no)$/i.test(v)) return 'boolean';
  if (!Number.isNaN(Date.parse(v)) && /[-/.]/.test(v)) return 'date';
  if (/<[^>]+>/.test(v)) return 'richtext';
  return 'string';
}

function inferSensitivity(key: string, label: string, value: string): Sensitivity {
  const hay = `${key} ${label} ${value}`.toLowerCase();
  if (/\b(salary|amount|price|cost|fee|payment|bank|account|credit.?card|routing|tax.?id|ein|vat|invoice|total|balance)\b/.test(hay)) {
    return 'financial';
  }
  if (/\b(health|medical|diagnosis|condition|patient)\b/.test(hay)) return 'health';
  if (/\b(ssn|social|pan|passport|dob|date of birth|driver|license|email|phone|address|employee.?id)\b/.test(hay)) {
    return 'pii';
  }
  return 'none';
}

function extractInlineValues(text: string): Variable[] {
  const variables: Variable[] = [];
  const seen = new Set<string>();
  const re = /^([^:\n]{1,80})\s*[:=]\s+([^\n]+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rawLabel = (m[1] ?? '').trim().replace(/[:=\s]+$/g, '');
    const value = (m[2] ?? '').trim();
    if (!rawLabel || !value) continue;
    const key = snake(rawLabel);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    variables.push({
      key,
      label: rawLabel,
      datatype: inferDatatype(value),
      required: false,
      askPolicy: 'from_prior',
      locator: { type: 'sample_text', text: value, context: rawLabel },
      sensitivity: inferSensitivity(key, rawLabel, value),
      sampleValue: value,
    });
  }
  return variables;
}

export async function analyzePriorArtifactBuffer(
  buffer: Buffer,
  format: MasterFormat,
  name: string,
): Promise<AnalyzeOutcome> {
  const text = await extractText(buffer, format, name);
  if (!text.trim()) return { state: 'failed', analysis: null, error: 'No extractable text in master' };

  const scanned = await scanTemplatePlaceholders(buffer, toTemplateFormat(format)).catch(() => []);
  const keys = new Set<string>(extractPlaceholderKeys(text));
  for (const f of scanned) keys.add(f.key);
  const placeholderFields = fieldsFromKeys(keys);

  const placeholderVars: Variable[] = placeholderFields.map((f) => ({
    key: f.key,
    label: f.label ?? f.key,
    datatype: 'string',
    required: false,
    askPolicy: 'from_prior',
    locator: { type: 'placeholder', token: `{{${f.key}}}` },
    sensitivity: 'none',
    sampleValue: '',
  }));

  const inlineVars = extractInlineValues(text);
  const byKey = new Map<string, Variable>();
  for (const v of placeholderVars) byKey.set(v.key, v);
  for (const v of inlineVars) byKey.set(v.key, v); // inline overrides placeholder

  const warnings: string[] = [];
  const variables = await enhanceLocators(buffer, format, [...byKey.values()], warnings);

  if (variables.length === 0) {
    warnings.push('No placeholders or inline values found — verify this is a prior artifact.');
  }

  return {
    state: variables.length > 0 ? 'ready' : 'partial',
    analysis: {
      kind: 'prior_artifact',
      documentType: 'prior_artifact',
      summary: `Prior artifact "${name}" (${format}): ${inlineVars.length} inline values and ${placeholderFields.length} placeholders extracted.`,
      confidence: variables.length > 0 ? 0.8 : 0.5,
      warnings,
      variables,
    },
  };
}

// ─── Structure master ───────────────────────────────────────────────────────

function extractMarkdownSections(text: string): SectionOutline[] {
  const sections: SectionOutline[] = [];
  const re = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const level = (m[1] ?? '').length;
    const title = (m[2] ?? '').trim();
    sections.push({ id: `s${sections.length + 1}`, title, level, required: true });
  }
  return sections;
}

function extractNumberedSections(text: string): SectionOutline[] {
  const sections: SectionOutline[] = [];
  const re = /^\s*(\d+(?:\.\d+)*)\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const level = (m[1] ?? '').split('.').length;
    const title = (m[2] ?? '').trim();
    sections.push({ id: `s${sections.length + 1}`, title, level: Math.min(level, 6), required: true });
  }
  return sections;
}

async function extractDocxSections(buffer: Buffer): Promise<SectionOutline[]> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string') ?? '';
  const sections: SectionOutline[] = [];
  const paraRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(documentXml)) !== null) {
    const p = m[0];
    const styleMatch = p.match(/<w:pStyle\b[^>]*?\bw:val="([^"]+)"/i);
    let level = 0;
    if (styleMatch) {
      const val = styleMatch[1] ?? '';
      const num = val.match(/^Heading(\d)$/i)?.[1] ?? val.match(/^(\d+)$/)?.[1];
      if (num) level = Number(num);
    }
    const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('');
    if (!text.trim()) continue;
    if (level === 0 && /^\d+(?:\.\d+)*\s+/.test(text)) {
      const firstToken = text.split(/\s/)[0] ?? '';
      level = firstToken.split('.').filter(Boolean).length;
    }
    if (level > 0) {
      sections.push({ id: `s${sections.length + 1}`, title: text.trim(), level: Math.min(level, 6), required: true });
    }
  }
  return sections;
}

async function extractStructureSections(
  buffer: Buffer,
  format: MasterFormat,
  text: string,
): Promise<SectionOutline[]> {
  if (format === 'docx') {
    try {
      const docxSections = await extractDocxSections(buffer);
      if (docxSections.length > 0) return docxSections;
    } catch { /* ignore */ }
  }
  const md = extractMarkdownSections(text);
  if (md.length > 0) return md;
  const numbered = extractNumberedSections(text);
  if (numbered.length > 0) return numbered;
  return [];
}

export async function analyzeStructureBuffer(
  buffer: Buffer,
  format: MasterFormat,
  name: string,
): Promise<AnalyzeOutcome> {
  const text = await extractText(buffer, format, name);
  if (!text.trim()) return { state: 'failed', analysis: null, error: 'No extractable text in master' };

  const sections = await extractStructureSections(buffer, format, text);

  const keys = new Set<string>(extractPlaceholderKeys(text));
  const scanned = await scanTemplatePlaceholders(buffer, toTemplateFormat(format)).catch(() => []);
  for (const f of scanned) keys.add(f.key);
  const placeholderFields = fieldsFromKeys(keys);

  const variables: Variable[] = placeholderFields.map((f) => ({
    key: f.key,
    label: f.label ?? f.key,
    datatype: 'string',
    required: false,
    askPolicy: 'ask',
    locator: { type: 'placeholder', token: `{{${f.key}}}` },
    sensitivity: 'none',
  }));

  const warnings: string[] = [];
  if (sections.length === 0 && variables.length === 0) {
    warnings.push('No sections or placeholder variables found — verify this is a structure master.');
  }

  const state = sections.length > 0 || variables.length > 0 ? 'ready' : 'partial';
  return {
    state,
    analysis: {
      kind: 'structure',
      documentType: 'structure',
      summary: `Structure master "${name}" (${format}): ${sections.length} sections and ${variables.length} placeholder variables.`,
      confidence: state === 'ready' ? 0.8 : 0.5,
      warnings,
      sections,
      variables,
    },
  };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function analyzeMasterBuffer(
  buffer: Buffer,
  kind: MasterKind,
  format: MasterFormat,
  name: string,
): Promise<AnalyzeOutcome> {
  switch (kind) {
    case 'data':
      return analyzeDataBuffer(buffer, name);
    case 'standard':
      return analyzeStandardBuffer(buffer, format, name);
    case 'layout':
      return analyzeLayoutBuffer(buffer, format, name);
    case 'structure':
      return analyzeStructureBuffer(buffer, format, name);
    case 'prior_artifact':
      return analyzePriorArtifactBuffer(buffer, format, name);
  }
}

/** Provisional kind from format/name (user-overridable, spec §5.1). */
export function classifyKind(format: MasterFormat, name: string): MasterKind {
  if (format === 'csv') return 'data';
  if (/standard|guideline|sop|policy|playbook|ich/i.test(name)) return 'standard';
  if (/structure|skeleton|outline/i.test(name)) return 'structure';
  if (/prior|previous|finalized|signed/i.test(name)) return 'prior_artifact';
  return 'layout';
}

export function detectMasterFormat(name: string, mimeType: string): MasterFormat {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const byExt: Record<string, MasterFormat> = {
    docx: 'docx', pdf: 'pdf', xlsx: 'xlsx', pptx: 'pptx', csv: 'csv', md: 'md', markdown: 'md',
  };
  if (byExt[ext]) return byExt[ext];
  if (mimeType.includes('wordprocessingml')) return 'docx';
  if (mimeType.includes('spreadsheetml')) return 'xlsx';
  if (mimeType.includes('presentationml')) return 'pptx';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/csv') return 'csv';
  if (mimeType === 'text/markdown') return 'md';
  return 'other';
}
