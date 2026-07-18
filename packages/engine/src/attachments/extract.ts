import { readFile } from 'node:fs/promises';
import type { AttachmentPreview } from '@agentx/shared';

export async function extractFromPath(
  path: string,
  mimeType: string,
): Promise<AttachmentPreview> {
  if (mimeType === 'application/pdf') {
    return extractPdfText(path);
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(path);
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return extractXlsx(path);
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return extractPptx(path);
  }
  if (mimeType.startsWith('text/') || isCodeFile(path) || mimeType === 'application/json') {
    const text = await readFile(path, 'utf-8');
    return { kind: 'text', content: text };
  }
  return { kind: 'error', content: `Preview not available for ${mimeType}` };
}

function isCodeFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return false;
  const codeExts = new Set([
    'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp',
    'h', 'cs', 'rb', 'php', 'swift', 'kt', 'sh', 'bash', 'zsh',
    'ps1', 'sql', 'yml', 'yaml', 'xml', 'toml', 'ini', 'cfg',
    'conf', 'json', 'md', 'txt',
  ]);
  return codeExts.has(ext);
}

async function extractPdfText(path: string): Promise<AttachmentPreview> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfData = await pdfjs.getDocument({ url: path } as unknown as any).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(pdfData.numPages, 10); i++) {
    const page = await pdfData.getPage(i);
    const text = await page.getTextContent();
    pages.push(text.items.map((item: any) => item.str).join(' '));
  }
  return { kind: 'text', content: pages.join('\n\n') };
}

async function extractDocx(path: string): Promise<AttachmentPreview> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path });
  return { kind: 'text', content: result.value };
}

async function extractXlsx(path: string): Promise<AttachmentPreview> {
  const Excel = (await import('exceljs')).default;
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(path);
  const first = workbook.worksheets[0];
  if (!first) return { kind: 'error', content: 'Empty workbook' };
  const rows: string[][] = [];
  const headers: string[] = [];
  let rowIdx = 0;
  first.eachRow({ includeEmpty: false }, (row: any) => {
    const cells = row.values.slice(1).map((v: unknown) => String(v ?? ''));
    if (rowIdx === 0) {
      headers.push(...cells);
    } else {
      rows.push(cells);
    }
    rowIdx++;
  });
  return { kind: 'table', headers, rows };
}

async function extractPptx(path: string): Promise<AttachmentPreview> {
  const JSZip = (await import('jszip')).default;
  const xml2js = await import('xml2js') as unknown as { parseStringPromise?: (xml: string) => Promise<unknown> };
  const parseStringPromise = xml2js.parseStringPromise ?? ((xml: string) => Promise.resolve(xml));
  const buffer = await readFile(path);
  const zip = await JSZip.loadAsync(buffer);
  const entries: string[] = [];
  const slideFiles = Object.keys(zip.files)
    .filter((n) => n.startsWith('ppt/slides/slide') && n.endsWith('.xml'))
    .sort();
  for (const name of slideFiles) {
    const xml = await zip.files[name]!.async('text');
    try {
      const obj = await parseStringPromise(xml);
      const text = collectText(obj);
      entries.push(`--- Slide ${name.replace(/[^0-9]/g, '')} ---\n${text}`);
    } catch {
      entries.push(`--- ${name} ---\n${xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
    }
  }
  return { kind: 'text', content: entries.join('\n\n') };
}

function collectText(obj: unknown): string {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map((item) => collectText(item)).join('');
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    if (typeof record._ === 'string' && record._) return record._;
    const textParts: string[] = [];
    if (Array.isArray(record['a:p'])) {
      for (const p of record['a:p']) {
        textParts.push(collectText(p));
      }
      return textParts.join('\n');
    }
    for (const value of Object.values(record)) {
      const part = collectText(value);
      if (part) textParts.push(part);
    }
    return textParts.join(' ');
  }
  return '';
}
