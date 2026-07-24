/**
 * Document Studio — transform compose adapter (Phase 6, spec §6.2).
 *
 * Text-format transformations on the primary master. Binary PDF/DOCX
 * redaction and watermarking are now supported as well.
 */

import { generateText } from 'ai';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PizZip from 'pizzip';
import { getAttachmentService } from '../../attachments/index.js';
import { tryCreateModel } from '../masters/analyzers.js';
import type { ComposeInput, ComposeOutput } from '../runner/PrimitiveRegistry.js';
import type { MasterFormat } from '../types.js';

function toUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const PII_PATTERNS = [
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'pan', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { name: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,32}\b/g },
  { name: 'creditCard', re: /\b(?:\d[ -]*){13,19}\b/g },
  { name: 'phone', re: /(?:\+\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g },
];

function redactText(text: string, values: Record<string, unknown>, keys: string[], autoPii: boolean): string {
  let out = text;
  for (const k of keys) {
    const v = String(values[k] ?? '');
    if (!v) continue;
    const escaped = escapeRegex(v);
    out = out.replace(new RegExp(escaped, 'g'), '[REDACTED]');
  }
  if (autoPii) {
    for (const p of PII_PATTERNS) {
      out = out.replace(p.re, '[REDACTED]');
    }
  }
  return out;
}

function hasRedactionMatch(str: string, values: Record<string, unknown>, keys: string[], autoPii: boolean): boolean {
  for (const k of keys) {
    const v = String(values[k] ?? '');
    if (v && str.includes(v)) return true;
  }
  if (autoPii) {
    for (const p of PII_PATTERNS) {
      p.re.lastIndex = 0;
      if (p.re.test(str)) return true;
    }
  }
  return false;
}

function redactDocx(buffer: Buffer, values: Record<string, unknown>, keys: string[], autoPii: boolean): Uint8Array {
  const zip = new PizZip(buffer);
  const files = (zip as any).file(/^word\/.+\.xml$/) ?? [];
  for (const f of files) {
    const original = f.asText();
    const updated = redactText(original, values, keys, autoPii);
    if (updated !== original) {
      (zip as any).file(f.name, updated);
    }
  }
  return Buffer.from((zip as any).generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function watermarkDocx(buffer: Buffer, wm: string): Uint8Array {
  const zip = new PizZip(buffer);
  let docXml = zip.file('word/document.xml')?.asText() ?? '';
  if (docXml) {
    const text = xmlEscape(wm);
    const snippet = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="C0C0C0"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const bodyEnd = docXml.lastIndexOf('</w:body>');
    if (bodyEnd !== -1) {
      docXml = docXml.slice(0, bodyEnd) + snippet + docXml.slice(bodyEnd);
    } else {
      docXml += snippet;
    }
    (zip as any).file('word/document.xml', docXml);
  }
  return Buffer.from((zip as any).generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function watermarkPdf(buffer: Buffer, wm: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = 48;
    const textWidth = font.widthOfTextAtSize(wm, size);
    page.drawText(wm, {
      x: (width - textWidth) / 2,
      y: height - 80,
      size,
      font,
      color: rgb(0.7, 0.7, 0.7),
    });
  }
  return Buffer.from(await doc.save());
}

async function redactPdf(
  buffer: Buffer,
  values: Record<string, unknown>,
  keys: string[],
  autoPii: boolean,
): Promise<Uint8Array> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;
  const data = new Uint8Array(buffer);
  const src = await pdfjs.getDocument({ data, useSystemFonts: true } as unknown as object).promise;
  const doc = await PDFDocument.load(buffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (let i = 1; i <= src.numPages; i++) {
    const page = await src.getPage(i);
    const content = await page.getTextContent();
    const target = pages[i - 1];
    if (!target) continue;

    for (const raw of content.items) {
      const item = raw as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };
      if (!item.str || !item.transform) continue;
      const [, , , , x, y] = item.transform;
      const w = item.width ?? 60;
      const h = item.height ?? 10;
      if (hasRedactionMatch(item.str, values, keys, autoPii)) {
        target.drawRectangle({
          x: x ?? 0,
          y: (y ?? 0) - 1,
          width: w,
          height: h + 2,
          color: rgb(1, 1, 1),
          opacity: 1,
        });
        target.drawText('[REDACTED]', {
          x: x ?? 0,
          y: y ?? 0,
          size: h,
          font,
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  return Buffer.from(await doc.save());
}

export async function composeTransform(input: ComposeInput): Promise<ComposeOutput> {
  const { master, bindingSet, transformOp } = input;
  const values = bindingSet?.values ?? {};
  const hints = (input as { adapterHints?: Record<string, unknown> }).adapterHints ?? {};
  const buffer = await getAttachmentService().getBuffer(master.storageId);
  const text = buffer ? buffer.toString('utf-8') : '';
  const format = master.format;
  const warnings: string[] = [];
  let result = text;
  let resultBytes: Uint8Array | undefined;

  switch (transformOp) {
    case 'redact': {
      const redactKeys = Array.isArray(hints['keys']) ? (hints['keys'] as string[]) : Object.keys(values);
      const autoPii = hints['autoPii'] === true;
      if (format === 'docx' || format === 'pdf') {
        try {
          resultBytes =
            format === 'docx'
              ? redactDocx(buffer ?? Buffer.from(''), values, redactKeys, autoPii)
              : await redactPdf(buffer ?? Buffer.from(''), values, redactKeys, autoPii);
          warnings.push(`${format.toUpperCase()} redaction applied.`);
        } catch (err) {
          warnings.push(
            `${format.toUpperCase()} binary redaction failed: ${err instanceof Error ? err.message : String(err)}; fallback to text-mode.`,
          );
          result = redactText(text, values, redactKeys, autoPii);
        }
      } else {
        result = redactText(result, values, redactKeys, autoPii);
      }
      break;
    }
    case 'watermark': {
      const wm = String(hints['watermark'] ?? values['watermark'] ?? 'Confidential');
      if (format === 'docx') {
        try {
          resultBytes = watermarkDocx(buffer ?? Buffer.from(''), wm);
          warnings.push('DOCX watermark applied to body.');
        } catch (err) {
          warnings.push(
            `DOCX watermark failed: ${err instanceof Error ? err.message : String(err)}; fallback to text-only overlay.`,
          );
          result = `--- ${wm} ---\n\n${result}\n\n--- ${wm} ---`;
        }
      } else if (format === 'pdf') {
        try {
          resultBytes = await watermarkPdf(buffer ?? Buffer.from(''), wm);
          warnings.push('PDF watermark applied to pages.');
        } catch (err) {
          warnings.push(
            `PDF watermark failed: ${err instanceof Error ? err.message : String(err)}; fallback to text-only overlay.`,
          );
          result = `--- ${wm} ---\n\n${result}\n\n--- ${wm} ---`;
        }
      } else {
        result = `--- ${wm} ---\n\n${result}\n\n--- ${wm} ---`;
        warnings.push('Watermark is text-only overlay.');
      }
      break;
    }
    case 'normalize': {
      result = result.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      break;
    }
    case 'diff_redline': {
      const baseMaster = input.secondary?.[0];
      const baseBuffer = baseMaster ? await getAttachmentService().getBuffer(baseMaster.storageId) : null;
      const baseText = baseBuffer ? baseBuffer.toString('utf-8') : '';
      const baseLines = baseText.split(/\r?\n/);
      const currentLines = result.split(/\r?\n/);
      const removed = baseLines.filter((l) => !currentLines.includes(l));
      const added = currentLines.filter((l) => !baseLines.includes(l));
      result = ['--- prior', '+++ current', ...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join('\n');
      warnings.push('diff_redline is a line-level text diff; paragraph moves may be imprecise.');
      break;
    }
    case 'split': {
      let separator: RegExp | string | undefined;
      try {
        const hint = String(hints['separator'] ?? '');
        separator = hint ? new RegExp(hint) : /\n{3,}/;
      } catch {
        separator = /\n{3,}/;
        warnings.push('Invalid separator regex; fallback to blank-line split.');
      }
      const parts = result.split(separator);
      result = parts.map((p, i) => `--- part ${i + 1} ---\n${p.trim()}`).join('\n\n');
      warnings.push(`Split into ${parts.length} parts.`);
      break;
    }
    case 'restyle': {
      const style = String(hints['style'] ?? 'plain');
      if (style === 'plain') {
        result = result
          .replace(/^[#\-*>`~]+\s*/gm, '')
          .replace(/\*\*|__|\*|_|`~/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .trim();
      } else {
        warnings.push(`Restyle '${style}' is not implemented; returning original text.`);
      }
      break;
    }
    case 'translate': {
      const targetLang = String(hints['targetLang'] ?? values['targetLang'] ?? '');
      if (!targetLang) {
        warnings.push('Translate requires targetLang; returning original text.');
        break;
      }
      const model = tryCreateModel();
      if (!model) {
        warnings.push(`Translation to '${targetLang}' is not available because no AI model is configured; returning original text.`);
        break;
      }
      try {
        const { text: translated } = await generateText({
          model,
          prompt: `Translate the following text into ${targetLang}. Return only the translated text, with no extra commentary or explanation.\n\n${result}`,
          maxOutputTokens: 8192,
          temperature: 0.1,
        });
        result = translated;
        warnings.push(`Translated text to '${targetLang}'.`);
      } catch (err) {
        warnings.push(`Translation to '${targetLang}' failed: ${err instanceof Error ? err.message : String(err)}; returning original text.`);
      }
      break;
    }
    default:
      warnings.push(`Transform op ${transformOp ?? 'none'} is not implemented.`);
  }

  return { bytes: resultBytes ?? toUtf8(result), format: format as MasterFormat, warnings };
}
