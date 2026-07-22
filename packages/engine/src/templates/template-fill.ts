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

async function fillDocx(buffer: Buffer, values: Record<string, string>): Promise<Buffer> {
  const zip = new PizZip(buffer);
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

async function fillXlsx(buffer: Buffer, values: Record<string, string>): Promise<Buffer> {
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
  if (format === 'docx') return fillDocx(buffer, values);
  if (format === 'xlsx') return fillXlsx(buffer, values);
  if (format === 'pdf') return fillPdfBuffer(buffer, fields, values);
  throw new Error(
    `Fill is not supported for ${format} templates. Upload a PDF, Word (.docx), or Excel (.xlsx) file.`,
  );
}
