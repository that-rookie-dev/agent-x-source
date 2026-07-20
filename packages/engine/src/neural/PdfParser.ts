/**
 * PDF text extraction using pdfjs-dist.
 *
 * Returns plain text and the number of pages extracted. Empty PDFs return
 * empty text so callers can decide whether to reject.
 */
export interface PdfParseResult {
  text: string;
  pages: number;
  info?: Record<string, unknown>;
}

function installDomMatrixPolyfill(): void {
  if (typeof globalThis !== 'undefined' && !('DOMMatrix' in globalThis)) {
    try {
      (globalThis as unknown as { DOMMatrix?: unknown }).DOMMatrix = class DOMMatrix {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
        m11 = 1; m12 = 0; m13 = 0; m14 = 0;
        m21 = 0; m22 = 1; m23 = 0; m24 = 0;
        m31 = 0; m32 = 0; m33 = 1; m34 = 0;
        m41 = 0; m42 = 0; m43 = 0; m44 = 1;
        is2D = true;
        isIdentity = true;
        constructor(init?: string | number[]) {
          if (typeof init === 'string') {
            const parts = init.split(/[,\s]+/).map(Number).filter((n) => !Number.isNaN(n));
            if (parts.length >= 6) {
              this.a = parts[0]!; this.b = parts[1]!; this.c = parts[2]!;
              this.d = parts[3]!; this.e = parts[4]!; this.f = parts[5]!;
            }
          } else if (Array.isArray(init)) {
            if (init.length >= 6) {
              this.a = init[0]!; this.b = init[1]!; this.c = init[2]!;
              this.d = init[3]!; this.e = init[4]!; this.f = init[5]!;
            }
          }
        }
        translate(_x?: number, _y?: number, _z?: number): DOMMatrix { return this; }
        scale(_x?: number, _y?: number, _z?: number): DOMMatrix { return this; }
        rotate(_x?: number, _y?: number, _z?: number): DOMMatrix { return this; }
        rotateAxisAngle(_x?: number, _y?: number, _z?: number, _angle?: number): DOMMatrix { return this; }
        skewX(_angle?: number): DOMMatrix { return this; }
        skewY(_angle?: number): DOMMatrix { return this; }
        multiply(_other?: DOMMatrix): DOMMatrix { return this; }
        flipX(): DOMMatrix { return this; }
        flipY(): DOMMatrix { return this; }
        inverse(): DOMMatrix { return this; }
        setMatrixValue(_value: string): DOMMatrix { return this; }
        transformPoint(_point?: any): any { return { x: 0, y: 0, z: 0, w: 1 }; }
        toString(): string { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
      };
    } catch { /* ignore */ }
  }
}
installDomMatrixPolyfill();

/** Minimal typed view of the pdfjs-dist module surface used by parsePdf. */
interface PdfjsModule {
  getDocument: (params: { data: Uint8Array; useSystemFonts?: boolean }) => { promise: Promise<{ numPages: number; getPage: (i: number) => Promise<{ getTextContent: () => Promise<{ items: Array<Record<string, unknown>> }> }> }> };
  GlobalWorkerOptions: { workerSrc: string };
}

export async function parsePdf(buffer: Buffer | ArrayBuffer): Promise<PdfParseResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfjsModule;
  const getDoc = pdfjs.getDocument;

  // In a Node.js (non-browser) environment, pdfjs-dist tries to set up a
  // "fake worker" on the main thread. It dynamically imports pdf.worker.mjs
  // relative to the pdf.mjs module. When bundled, this import can break.
  // By explicitly setting workerSrc to the resolved path, we ensure the
  // worker module is found at runtime.
  try {
    const workerUrl = await import('node:url');
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const workerModulePath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.pathToFileURL(workerModulePath).href;
  } catch { /* best-effort — if this fails, pdfjs will try its default resolution */ }

  const data = new Uint8Array(buffer);
  const doc = await getDoc({ data, useSystemFonts: true }).promise;
  const pages = doc.numPages;
  const lines: string[] = [];

  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: Record<string, unknown>) => ('str' in item ? String(item['str'] ?? '') : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) lines.push(text);
  }

  return { text: lines.join('\n\n'), pages };
}
