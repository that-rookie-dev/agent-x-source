import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { TemplateField } from '@agentx/shared';

interface TextItemLoc {
  str: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Locate sample text / blank tokens in a PDF for overlay substitution. */
export async function locatePdfFieldTargets(
  buffer: Buffer,
  fields: TemplateField[],
): Promise<TemplateField[]> {
  const items = await extractPdfTextItems(buffer);
  const used = new Set<number>();
  return fields.map((field) => {
    if (field.page != null && field.x != null && field.y != null) return field;
    const sample = (field.sampleValue ?? '').trim();
    const blank = (field.blankToken ?? '').trim();
    const candidates = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it, idx }) => {
        if (used.has(idx)) return false;
        if (sample && it.str.includes(sample)) return true;
        if (blank && it.str.includes(blank)) return true;
        if (/_{3,}|\.{4,}/.test(it.str)) return true;
        return false;
      });

    let pick = candidates[0];
    if (field.context && candidates.length > 0) {
      const ctx = field.context.toLowerCase();
      for (const c of candidates) {
        const prior = items.find((p, pi) =>
          pi < c.idx
          && p.page === c.it.page
          && p.str.toLowerCase().includes(ctx),
        );
        if (prior) {
          pick = c;
          break;
        }
      }
    }
    if (!pick) return field;
    used.add(pick.idx);
    const coverW = sample
      ? Math.max(pick.it.width, 40)
      : Math.max(pick.it.width, 80);
    return {
      ...field,
      page: pick.it.page,
      x: pick.it.x,
      y: pick.it.y,
      width: coverW,
      fontSize: Math.max(8, Math.min(14, pick.it.height || 10)),
    };
  });
}

async function extractPdfTextItems(buffer: Buffer): Promise<TextItemLoc[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true } as unknown as object).promise;
  const out: TextItemLoc[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const raw of content.items) {
      const item = raw as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };
      if (!item.str || !item.transform) continue;
      const [, , , , x, y] = item.transform;
      out.push({
        str: item.str,
        page: p,
        x: x ?? 0,
        // pdf.js y is from bottom; pdf-lib also uses bottom-left origin
        y: y ?? 0,
        width: item.width ?? 60,
        height: item.height ?? 10,
      });
      void viewport;
    }
  }
  return out;
}

/**
 * Substitute content slots on a PDF master: cover sample/blank regions,
 * then draw provided values (or leave blank when value is empty).
 * Layout / page graphics from the template are preserved.
 */
export async function fillPdfBuffer(
  buffer: Buffer,
  fields: TemplateField[],
  values: Record<string, string>,
): Promise<Buffer> {
  const located = await locatePdfFieldTargets(buffer, fields);
  const doc = await PDFDocument.load(buffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const field of located) {
    if (field.page == null || field.x == null || field.y == null) continue;
    const page = pages[field.page - 1];
    if (!page) continue;
    const size = field.fontSize ?? 10;
    const raw = values[field.key];
    const text = raw == null ? '' : String(raw);
    const coverW = field.width
      ?? Math.max(80, text ? font.widthOfTextAtSize(text, size) + 4 : 80);

    // Always clear sample/blank region so leftover demo text does not remain.
    if (field.sampleValue || field.blankToken || Object.prototype.hasOwnProperty.call(values, field.key)) {
      page.drawRectangle({
        x: field.x,
        y: field.y - 1,
        width: coverW,
        height: size + 2,
        color: rgb(1, 1, 1),
        opacity: 1,
      });
    }

    if (!text.trim()) continue;
    page.drawText(text, {
      x: field.x,
      y: field.y,
      size,
      font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: coverW,
    });
  }

  // Also try AcroForm fields by name/partial match
  try {
    const form = doc.getForm();
    for (const field of located) {
      const value = values[field.key];
      if (value == null) continue;
      const candidates = form.getFields().filter((f) => {
        const name = f.getName().toLowerCase();
        return name === field.key.toLowerCase()
          || name.includes(field.key.toLowerCase())
          || (field.label && name.includes(field.label.toLowerCase().replace(/\s+/g, '')));
      });
      for (const f of candidates) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyField = f as any;
          if (typeof anyField.setText === 'function') anyField.setText(String(value));
        } catch {
          /* ignore incompatible widget */
        }
      }
    }
  } catch {
    /* no AcroForm */
  }

  return Buffer.from(await doc.save());
}
