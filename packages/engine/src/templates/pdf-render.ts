/**
 * PDF → PNG rasterizer for the Document Studio visual scanner.
 *
 * Renders selected pages of a PDF to PNG buffers using pdfjs-dist + a Node
 * canvas implementation (@napi-rs/canvas). The PNG bytes are meant to be
 * attached as `image` content parts to a vision-capable LLM call so the
 * model can reason about the exact visual layout (page size, orientation,
 * region geometry, table grids) of a master document.
 *
 * Rendering is best-effort: if the canvas backend or pdfjs fails to render a
 * page, that page is skipped and reported in `warnings` rather than throwing,
 * so analysis can fall back to text-only extraction.
 */

import { getLogger } from '@agentx/shared';

export interface RenderedPdfPage {
  page: number; // 1-based
  png: Buffer;
  widthPx: number;
  heightPx: number;
  widthPt: number; // PDF points (1/72 inch)
  heightPt: number;
  orientation: 'landscape' | 'portrait';
}

export interface RenderPdfPagesOptions {
  /** Pages to render (1-based). Defaults to all pages. */
  pages?: number[];
  /** Target DPI. Higher = sharper for the vision model but larger payload. Default 150. */
  dpi?: number;
  /** Max pages to render regardless of input (safety cap). Default 4. */
  maxPages?: number;
  /** Max edge in pixels; pages are downscaled if they exceed this. Default 2000. */
  maxEdgePx?: number;
}

export interface RenderPdfPagesResult {
  pages: RenderedPdfPage[];
  warnings: string[];
  numPages: number;
}

interface PdfjsPage {
  getViewport(args: { scale: number }): { width: number; height: number };
  render(args: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
}
interface PdfjsDoc {
  numPages: number;
  getPage(i: number): Promise<PdfjsPage>;
}

/**
 * Render selected PDF pages to PNG. Returns one RenderedPdfPage per page plus
 * warnings for any page that could not be rasterized.
 */
export async function renderPdfPagesToPng(
  buffer: Buffer,
  opts: RenderPdfPagesOptions = {},
): Promise<RenderPdfPagesResult> {
  const dpi = opts.dpi ?? 150;
  const maxPages = opts.maxPages ?? 4;
  const maxEdgePx = opts.maxEdgePx ?? 2000;
  const warnings: string[] = [];
  const out: RenderedPdfPage[] = [];

  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (p: { data: Uint8Array; useSystemFonts?: boolean }) => { promise: Promise<PdfjsDoc> };
    GlobalWorkerOptions: { workerSrc: string };
  };

  // Ensure the worker resolves when bundled (same pattern as PdfParser).
  try {
    const { pathToFileURL } = await import('node:url');
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  } catch { /* best-effort */ }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const numPages = doc.numPages;

  let wanted: number[];
  if (opts.pages && opts.pages.length > 0) {
    wanted = opts.pages.slice(0, maxPages);
  } else {
    wanted = [];
    for (let i = 1; i <= Math.min(numPages, maxPages); i++) wanted.push(i);
  }

  // Lazily load the canvas backend so a load failure doesn't break text-only paths.
  let canvasModule: typeof import('@napi-rs/canvas') | null = null;
  try {
    canvasModule = await import('@napi-rs/canvas');
  } catch (err) {
    warnings.push(`@napi-rs/canvas unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return { pages: out, warnings, numPages };
  }

  for (const pageNum of wanted) {
    try {
      const page = await doc.getPage(pageNum);
      // 72 PDF points per inch; scale = dpi / 72.
      const baseScale = dpi / 72;
      const baseVp = page.getViewport({ scale: baseScale });
      let scale = baseScale;
      const longestEdge = Math.max(baseVp.width, baseVp.height);
      if (longestEdge > maxEdgePx) scale = baseScale * (maxEdgePx / longestEdge);
      const viewport = page.getViewport({ scale });
      const widthPx = Math.ceil(viewport.width);
      const heightPx = Math.ceil(viewport.height);

      const canvas = canvasModule.createCanvas(widthPx, heightPx);
      const ctx = canvas.getContext('2d');
      // pdfjs expects a white background; @napi-rs/canvas defaults to transparent.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, widthPx, heightPx);

      await page.render({ canvasContext: ctx as unknown, viewport: viewport as unknown }).promise;

      const png = canvas.toBuffer('image/png');
      out.push({
        page: pageNum,
        png,
        widthPx,
        heightPx,
        widthPt: Math.round(viewport.width / scale),
        heightPt: Math.round(viewport.height / scale),
        orientation: viewport.width >= viewport.height ? 'landscape' : 'portrait',
      });
    } catch (err) {
      warnings.push(`page ${pageNum} render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (out.length === 0 && wanted.length > 0) {
    getLogger().warn('PDF_RENDER', 'renderPdfPagesToPng produced 0 pages; visual analysis will be skipped');
  }
  return { pages: out, warnings, numPages };
}

/** Convenience: render the first page only (common case for single-page forms). */
export async function renderPdfFirstPageToPng(
  buffer: Buffer,
  dpi = 150,
): Promise<RenderedPdfPage | null> {
  const res = await renderPdfPagesToPng(buffer, { pages: [1], dpi, maxPages: 1 });
  return res.pages[0] ?? null;
}
