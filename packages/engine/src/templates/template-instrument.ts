import JSZip from 'jszip';
import type { TemplateField, TemplateFormat } from '@agentx/shared';

/**
 * Internally rewrite variable content slots in docx/xlsx to `{{key}}` so
 * generation can clone the binary master and substitute data.
 * Prefer replacing sample/example text from the design; fall back to blank
 * tokens / underscore leaders. Never invent slots by filling random empty cells.
 */
export async function instrumentTemplateBuffer(
  buffer: Buffer,
  format: TemplateFormat,
  fields: TemplateField[],
): Promise<Buffer> {
  const targets = fields.filter((f) => f.source !== 'placeholder');
  if (targets.length === 0) return buffer;
  if (format === 'docx') return instrumentDocx(buffer, targets);
  if (format === 'xlsx') return instrumentXlsx(buffer, targets);
  return buffer;
}

async function instrumentDocx(buffer: Buffer, fields: TemplateField[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const used = new Set<string>();

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('word/') || !name.endsWith('.xml')) continue;
    let xml = await entry.async('string');
    let changed = false;
    for (const field of fields) {
      if (used.has(field.key)) continue;
      const next = replaceSlotInXml(xml, field);
      if (next !== xml) {
        xml = next;
        used.add(field.key);
        changed = true;
      }
    }
    if (changed) zip.file(name, xml);
  }

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function replaceSlotInXml(xml: string, field: TemplateField): string {
  const placeholder = `{{${field.key}}}`;
  if (xml.includes(placeholder)) return xml;

  // 1) Replace exact sample/example text from the design (primary path).
  const sample = (field.sampleValue ?? '').trim();
  if (sample.length >= 1) {
    const idx = findTextNearContext(xml, sample, field.context);
    if (idx >= 0) {
      return xml.slice(0, idx) + placeholder + xml.slice(idx + sample.length);
    }
  }

  // 2) Replace observed blank token.
  const blank = (field.blankToken ?? '').trim();
  if (blank.length >= 2) {
    const idx = findTextNearContext(xml, blank, field.context);
    if (idx >= 0) {
      return xml.slice(0, idx) + placeholder + xml.slice(idx + blank.length);
    }
  }

  // 3) Underscore / leader runs inside <w:t>…</w:t>
  const re = /(<w:t[^>]*>)([^<]*?)(_{3,}|\.{4,})([^<]*?)(<\/w:t>)/;
  if (field.context) {
    const ctxIdx = xml.toLowerCase().indexOf(field.context.toLowerCase());
    if (ctxIdx >= 0) {
      const slice = xml.slice(ctxIdx);
      const m = re.exec(slice);
      if (m && m.index != null) {
        const abs = ctxIdx + m.index;
        const full = m[0];
        const replaced = `${m[1]}${m[2]}${placeholder}${m[4]}${m[5]}`;
        return xml.slice(0, abs) + replaced + xml.slice(abs + full.length);
      }
    }
  }

  const m = re.exec(xml);
  if (m && m.index != null) {
    const replaced = `${m[1]}${m[2]}${placeholder}${m[4]}${m[5]}`;
    return xml.slice(0, m.index) + replaced + xml.slice(m.index + m[0].length);
  }

  // 4) Empty after a label in the same text run: "Name: " → "Name: {{key}}"
  if (field.context) {
    const label = field.context.replace(/[:：]\s*$/, '');
    const labelRe = new RegExp(
      `(<w:t[^>]*>)([^<]*${escapeRegExp(label)}\\s*[:：]?\\s*)(</w:t>)`,
      'i',
    );
    const lm = labelRe.exec(xml);
    if (lm && lm.index != null) {
      const replaced = `${lm[1]}${lm[2]}${placeholder}${lm[3]}`;
      return xml.slice(0, lm.index) + replaced + xml.slice(lm.index + lm[0].length);
    }
  }

  return xml;
}

function findTextNearContext(xml: string, needle: string, context?: string): number {
  if (!context) return xml.indexOf(needle);
  const lower = xml.toLowerCase();
  const ctx = context.toLowerCase();
  let from = 0;
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  while (from < xml.length) {
    const ci = lower.indexOf(ctx, from);
    if (ci < 0) break;
    const bi = xml.indexOf(needle, Math.max(0, ci - 80));
    if (bi >= 0) {
      const dist = Math.abs(bi - ci);
      if (dist < bestDist && dist < 500) {
        best = bi;
        bestDist = dist;
      }
    }
    from = ci + ctx.length;
  }
  if (best >= 0) return best;
  return xml.indexOf(needle);
}

async function instrumentXlsx(buffer: Buffer, fields: TemplateField[]): Promise<Buffer> {
  const Excel = (await import('exceljs')).default;
  const wb = new Excel.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const pending = [...fields];

  for (const sheet of wb.worksheets) {
    sheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (pending.length === 0) return;
        const text = cellText(cell.value);
        for (let i = 0; i < pending.length; i++) {
          const field = pending[i]!;
          const placeholder = `{{${field.key}}}`;
          if (text.includes(placeholder)) {
            pending.splice(i, 1);
            return;
          }

          const sample = (field.sampleValue ?? '').trim();
          if (sample && text.includes(sample)) {
            cell.value = text.replace(sample, placeholder);
            pending.splice(i, 1);
            return;
          }

          const blank = (field.blankToken ?? '').trim();
          if (blank && text.includes(blank)) {
            cell.value = text.replace(blank, placeholder);
            pending.splice(i, 1);
            return;
          }

          if (/_{3,}|\.{4,}/.test(text)) {
            const ctxOk = !field.context || text.toLowerCase().includes(field.context.toLowerCase());
            if (ctxOk) {
              cell.value = text.replace(/_{3,}|\.{4,}/, placeholder);
              pending.splice(i, 1);
              return;
            }
          }
        }
      });
    });
  }

  // Remaining slots with context: empty cell next to a cell containing the context label.
  if (pending.length > 0) {
    for (const sheet of wb.worksheets) {
      sheet.eachRow({ includeEmpty: true }, (row) => {
        const cells: Array<{ col: number; text: string }> = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cells.push({ col, text: cellText(cell.value) });
        });
        for (let i = pending.length - 1; i >= 0; i--) {
          const field = pending[i]!;
          if (!field.context) continue;
          const ctx = field.context.toLowerCase();
          const labelIdx = cells.findIndex((c) => c.text.toLowerCase().includes(ctx));
          if (labelIdx < 0) continue;
          const labelCol = cells[labelIdx]!.col;
          const valueCell = row.getCell(labelCol + 1);
          const valueText = cellText(valueCell.value);
          if (valueText.trim() && !(field.sampleValue && valueText.includes(field.sampleValue))) {
            continue;
          }
          valueCell.value = `{{${field.key}}}`;
          pending.splice(i, 1);
        }
      });
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && v && 'richText' in v) {
    return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
  }
  if (typeof v === 'object' && v && 'text' in v && typeof (v as { text: unknown }).text === 'string') {
    return (v as { text: string }).text;
  }
  return String(v);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
