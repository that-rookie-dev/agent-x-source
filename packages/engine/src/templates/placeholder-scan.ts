import JSZip from 'jszip';
import type { TemplateField, TemplateFormat } from '@agentx/shared';

/** `{{field_key}}` — letters, digits, underscore, dot, hyphen. */
export const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export function humanizeFieldKey(key: string): string {
  return key
    .replace(/[_.-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || key;
}

export function fieldsFromKeys(keys: Iterable<string>): TemplateField[] {
  const seen = new Set<string>();
  const fields: TemplateField[] = [];
  for (const raw of keys) {
    const key = raw.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fields.push({ key, label: humanizeFieldKey(key), required: true });
  }
  return fields.sort((a, b) => a.key.localeCompare(b.key));
}

export function extractPlaceholderKeys(text: string): string[] {
  const keys: string[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    if (m[1]) keys.push(m[1]);
  }
  return keys;
}

export function detectTemplateFormat(filename: string, mimeType?: string): TemplateFormat {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx';
  }
  if (ext === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return 'xlsx';
  }
  if (ext === 'pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return 'pptx';
  }
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'doc' || mimeType === 'application/msword') return 'doc';
  return 'other';
}

/** Formats we can produce a filled copy for after analysis/instrumentation. */
export function isFillableFormat(format: TemplateFormat): boolean {
  return format === 'docx' || format === 'xlsx' || format === 'pdf';
}

/** Concatenate Word text runs for detection (ignores XML split of placeholders). */
function docxPlainText(xml: string): string {
  const parts: string[] = [];
  for (const m of xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)) {
    if (m[1]) parts.push(m[1]);
  }
  return parts.join('');
}

function pptxPlainText(xml: string): string {
  const parts: string[] = [];
  for (const m of xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) {
    if (m[1]) parts.push(m[1]);
  }
  return parts.join('');
}

async function scanZipText(
  buffer: Buffer,
  pathFilter: (name: string) => boolean,
  extract: (xml: string) => string,
): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const keys: string[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !pathFilter(name)) continue;
    const xml = await entry.async('string');
    keys.push(...extractPlaceholderKeys(extract(xml)));
  }
  return keys;
}

async function scanXlsx(buffer: Buffer): Promise<string[]> {
  const Excel = (await import('exceljs')).default;
  const wb = new Excel.Workbook();
  // exceljs typings accept Buffer via load
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const keys: string[] = [];
  for (const sheet of wb.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (typeof v === 'string') {
          keys.push(...extractPlaceholderKeys(v));
        } else if (v && typeof v === 'object' && 'richText' in v) {
          const text = (v as { richText: Array<{ text: string }> }).richText
            .map((r) => r.text)
            .join('');
          keys.push(...extractPlaceholderKeys(text));
        } else if (v && typeof v === 'object' && 'text' in v && typeof (v as { text: unknown }).text === 'string') {
          keys.push(...extractPlaceholderKeys((v as { text: string }).text));
        }
      });
    });
  }
  return keys;
}

/**
 * Discover `{{field}}` placeholders in a template buffer.
 * PDF / unknown formats return no fields (kept as reference binaries).
 */
export async function scanTemplatePlaceholders(
  buffer: Buffer,
  format: TemplateFormat,
): Promise<TemplateField[]> {
  if (format === 'docx') {
    const keys = await scanZipText(
      buffer,
      (n) => n.startsWith('word/') && n.endsWith('.xml'),
      docxPlainText,
    );
    return fieldsFromKeys(keys);
  }
  if (format === 'xlsx') {
    return fieldsFromKeys(await scanXlsx(buffer));
  }
  if (format === 'pptx') {
    const keys = await scanZipText(
      buffer,
      (n) => n.startsWith('ppt/slides/') && n.endsWith('.xml'),
      pptxPlainText,
    );
    return fieldsFromKeys(keys);
  }
  return [];
}
