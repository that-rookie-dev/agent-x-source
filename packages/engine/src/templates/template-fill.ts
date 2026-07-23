import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import type { TemplateField, TemplateFormat } from '@agentx/shared';
import { PLACEHOLDER_RE } from './placeholder-scan.js';
import { fillPdfBuffer } from './pdf-fill.js';

function applyStringPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (_full, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key] ?? '';
    }
    return `{{${key}}}`;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function injectAtBookmark(xml: string, name: string, key: string): string {
  const startRe = new RegExp('<w:bookmarkStart[^>]*?w:name="' + escapeRegex(name) + '"[^>]*?\\/>', 'i');
  const startMatch = startRe.exec(xml);
  if (!startMatch) return xml;
  const endRe = /<w:bookmarkEnd[^>]*?\/>/i;
  endRe.lastIndex = startMatch.index + startMatch[0].length;
  const endMatch = endRe.exec(xml);
  if (!endMatch) return xml;
  return xml.slice(0, startMatch.index + startMatch[0].length)
    + '<w:r><w:t>{{' + key + '}}</w:t></w:r>'
    + xml.slice(endMatch.index);
}

function injectAtContentControl(xml: string, tag: string, key: string): string {
  const tagRe = new RegExp('<w:tag[^>]*?w:val="' + escapeRegex(tag) + '"[^>]*?>', 'i');
  const tagMatch = tagRe.exec(xml);
  if (!tagMatch) return xml;
  const contentStart = xml.indexOf('<w:sdtContent', tagMatch.index + tagMatch[0].length);
  if (contentStart === -1) return xml;
  const contentOpenEnd = xml.indexOf('>', contentStart);
  if (contentOpenEnd === -1) return xml;
  const contentEnd = xml.indexOf('</w:sdtContent>', contentOpenEnd);
  if (contentEnd === -1) return xml;
  return xml.slice(0, contentOpenEnd + 1)
    + '<w:p><w:r><w:t>{{' + key + '}}</w:t></w:r></w:p>'
    + xml.slice(contentEnd);
}

function injectAtTableCell(
  xml: string,
  tableId: number,
  row: number,
  col: number,
  key: string,
): string {
  const tables = xml.split('<w:tbl');
  if (tableId >= tables.length || Number.isNaN(tableId)) return xml;
  const table = tables[tableId]!;
  const rows = table.split('<w:tr');
  if (row >= rows.length) return xml;
  const targetRow = rows[row]!;
  const cells = targetRow.split('<w:tc');
  if (col >= cells.length) return xml;
  const cell = cells[col]!;
  const openEnd = cell.indexOf('>');
  const contentEnd = cell.indexOf('</w:tc>');
  if (openEnd === -1 || contentEnd === -1) return xml;
  const newCell = cell.slice(0, openEnd + 1)
    + '<w:p><w:r><w:t>{{' + key + '}}</w:t></w:r></w:p>'
    + cell.slice(contentEnd);
  cells[col] = newCell;
  rows[row] = cells.join('<w:tc');
  tables[tableId] = rows.join('<w:tr');
  return tables.join('<w:tbl');
}

async function fillDocx(buffer: Buffer, values: Record<string, string>, fields: TemplateField[] = []): Promise<Buffer> {
  const zip = new PizZip(buffer);
  const docXml = zip.file('word/document.xml')?.asText() ?? '';
  if (docXml) {
    let updated = docXml;
    for (const field of fields as Array<TemplateField & { adapterHints?: Record<string, unknown> }>) {
      const hint = field.adapterHints;
      if (!hint) continue;
      if (hint.type === 'bookmark' && typeof hint.name === 'string') {
        updated = injectAtBookmark(updated, hint.name, field.key);
      } else if (hint.type === 'content_control' && typeof hint.tag === 'string') {
        updated = injectAtContentControl(updated, hint.tag, field.key);
      } else if (
        hint.type === 'table_cell'
        && typeof hint.tableId === 'string'
        && typeof hint.row === 'number'
        && typeof hint.col === 'number'
      ) {
        updated = injectAtTableCell(updated, Number(hint.tableId), hint.row, hint.col, field.key);
      }
    }
    if (updated !== docXml) {
      zip.file('word/document.xml', updated);
    }
  }

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',
  });
  doc.render(values);
  const out = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  return Buffer.from(out);
}

async function fillXlsx(buffer: Buffer, values: Record<string, string>, fields: TemplateField[] = []): Promise<Buffer> {
  const Excel = (await import('exceljs')).default;
  const wb = new Excel.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  for (const sheet of wb.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (typeof v === 'string' && v.includes('{{')) {
          cell.value = applyStringPlaceholders(v, values);
        } else if (v && typeof v === 'object' && 'richText' in v) {
          const rich = v as { richText: Array<{ text: string; font?: unknown }> };
          const joined = rich.richText.map((r) => r.text).join('');
          if (joined.includes('{{')) {
            // Preserve simple case: replace whole cell as plain text when placeholders span runs.
            cell.value = applyStringPlaceholders(joined, values);
          }
        } else if (
          v
          && typeof v === 'object'
          && 'text' in v
          && typeof (v as { text: unknown }).text === 'string'
          && (v as { text: string }).text.includes('{{')
        ) {
          const nextText = applyStringPlaceholders((v as { text: string }).text, values);
          cell.value = { ...(v as object as Record<string, unknown>), text: nextText } as typeof v;
        }
      });
    });
  }

  for (const field of fields as Array<TemplateField & { adapterHints?: Record<string, unknown> }>) {
    const hint = field.adapterHints;
    if (hint?.type === 'sheet_cell' && typeof hint.sheet === 'string' && typeof hint.cell === 'string') {
      const ws = wb.getWorksheet(hint.sheet);
      if (ws) ws.getCell(hint.cell).value = values[field.key] ?? '';
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Produce a design-faithful copy of a template buffer (same format/layout).
 * DOCX/XLSX substitute {{placeholders}} (instrumented from design slots / sample text).
 * PDF overlays values at located sample/blank coordinates / AcroForm fields.
 * Missing values become blank; unknown keys are ignored.
 */
export async function fillTemplateBuffer(
  buffer: Buffer,
  format: TemplateFormat,
  values: Record<string, string>,
  fields: TemplateField[] = [],
): Promise<Buffer> {
  if (format === 'docx') return fillDocx(buffer, values, fields);
  if (format === 'xlsx') return fillXlsx(buffer, values, fields);
  if (format === 'pdf') return fillPdfBuffer(buffer, fields, values);
  throw new Error(
    `Fill is not supported for ${format} templates. Upload a PDF, Word (.docx), or Excel (.xlsx) file.`,
  );
}
