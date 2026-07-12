import type { UIMessage } from '../chat/types';
import { deriveMarkdownTitle, sanitizeMarkdownDeliverable } from '@agentx/shared/browser';
import { displayContent } from '../chat/utils';

/** Serialize a chat message into markdown for document storage (preserves chart parts). */
export function messageToMarkdownDocument(message: UIMessage): string {
  const chunks: string[] = [];
  if (message.parts?.length) {
    for (const part of message.parts) {
      if (part.type === 'text' && part.content?.trim()) {
        chunks.push(part.content.trim());
      } else if (part.type === 'chart' && part.chartJson?.trim()) {
        chunks.push(`\`\`\`chart\n${part.chartJson.trim()}\n\`\`\``);
      }
    }
  }
  const fromParts = chunks.join('\n\n').trim();
  const raw = fromParts || displayContent(message);
  return sanitizeMarkdownDeliverable(raw);
}

/** Derive a markdown document title from a chat message body. */
export function deriveMarkdownTitleFromMessage(message: UIMessage): string {
  const markdown = messageToMarkdownDocument(message);
  return deriveMarkdownTitle({ contentMarkdown: markdown });
}

export interface MarkdownPdfSaveOptions {
  defaultFilename: string;
}

const PDF_COLOR_PROPS = [
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
] as const;

const PDF_SHADOW_PROPS = ['box-shadow', 'text-shadow'] as const;
const PDF_BACKGROUND_PROPS = ['background', 'background-image'] as const;

const MODERN_COLOR_RE = /(?:oklch|oklab|lab|lch|color-mix|color)\s*\((?:[^()]*|\([^)]*\))*\)/i;
const MODERN_COLOR_RE_GLOBAL = new RegExp(MODERN_COLOR_RE.source, 'gi');

/** Build a normalizer that converts any CSS color to an html2canvas-safe rgb/rgba string. */
function createColorNormalizer(doc: Document): (_value: string, _fallbackColor?: string) => string | null {
  const canvas = doc.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, string | null>();
  if (!ctx) return (_value: string, _fallbackColor?: string) => null;

  return (value: string, fallbackColor?: string): string | null => {
    const key = value + (fallbackColor ? `|${fallbackColor}` : '');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed === 'none') {
      cache.set(key, null);
      return null;
    }
    if (trimmed === 'transparent') {
      const out = 'rgba(0, 0, 0, 0)';
      cache.set(key, out);
      return out;
    }
    if (trimmed === 'currentcolor' || trimmed === 'invert') {
      const out = fallbackColor || 'rgb(0, 0, 0)';
      cache.set(key, out);
      return out;
    }

    // html2canvas already handles legacy rgb/rgba/hex/hsl/hsla and named colors.
    if (
      /^rgba?\s*\(/.test(trimmed) ||
      /^#[0-9a-f]{3,8}$/.test(trimmed) ||
      /^hsla?\s*\(/.test(trimmed) ||
      /^[a-z]+$/.test(trimmed)
    ) {
      cache.set(key, value);
      return value;
    }

    // Use the canvas' CSS color parser to convert modern color functions.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    const parsed = ctx.fillStyle;
    if (parsed && !MODERN_COLOR_RE.test(parsed)) {
      cache.set(key, parsed);
      return parsed;
    }

    // The canvas serialized the color as another modern function (e.g. color(srgb ...)).
    // Sample the rendered pixel to get a safe sRGB representation.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const out = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    cache.set(key, out);
    return out;
  };
}

/** Replace any color()/color-mix()/oklch() value in a CSS value string with html2canvas-safe rgb/rgba. */
function normalizeColorValues(
  value: string,
  fallbackColor: string,
  normalizeColor: (_value: string, _fallbackColor?: string) => string | null,
): string | null {
  if (!value || value === 'none') return null;
  let normalized = value.replace(MODERN_COLOR_RE_GLOBAL, (match) => normalizeColor(match) || 'rgb(0, 0, 0)');
  if (fallbackColor) {
    normalized = normalized.replace(/\bcurrentcolor\b/gi, fallbackColor);
  }
  return normalized;
}

/** Inline computed rgb/rgba colors so html2canvas never parses color()/color-mix()/oklch() from stylesheets. */
function inlineComputedColorsForPdf(cloneRoot: HTMLElement): void {
  const win = cloneRoot.ownerDocument.defaultView;
  if (!win) return;

  const normalizeColor = createColorNormalizer(cloneRoot.ownerDocument);
  const elements = [cloneRoot, ...cloneRoot.querySelectorAll('*')] as HTMLElement[];

  for (const clone of elements) {
    if (!(clone instanceof HTMLElement)) continue;
    const computed = win.getComputedStyle(clone);
    const color = normalizeColor(computed.getPropertyValue('color'));
    if (color) clone.style.setProperty('color', color);
    const fallbackColor = color || 'rgb(0, 0, 0)';

    for (let i = 1; i < PDF_COLOR_PROPS.length; i++) {
      const prop = PDF_COLOR_PROPS[i]!;
      const value = computed.getPropertyValue(prop);
      const normalized = normalizeColor(value, fallbackColor);
      if (normalized) clone.style.setProperty(prop, normalized);
    }

    for (const prop of PDF_SHADOW_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none') {
        const normalized = normalizeColorValues(value, fallbackColor, normalizeColor);
        if (normalized) clone.style.setProperty(prop, normalized);
      }
    }

    for (const prop of PDF_BACKGROUND_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none') {
        const normalized = normalizeColorValues(value, fallbackColor, normalizeColor);
        if (normalized && normalized !== value) {
          clone.style.setProperty(prop, normalized);
        }
      }
    }
  }
}

/** Capture a DOM subtree and produce a multi-page PDF blob (WYSIWYG). */
export async function exportElementToPdfBlob(root: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  await new Promise((r) => setTimeout(r, 400));

  const backgroundColor = getComputedStyle(root).backgroundColor || '#ffffff';

  const canvas = await html2canvas(root, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor,
    windowWidth: root.scrollWidth,
    windowHeight: root.scrollHeight,
    onclone: (doc) => {
      const cloneRoot = doc.querySelector('[data-markdown-export-root]');
      if (cloneRoot instanceof HTMLElement) {
        inlineComputedColorsForPdf(cloneRoot);
      }
    },
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const contentWidth = pageWidth - margin * 2;
  const imgWidth = contentWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  const fillPageBackground = () => {
    pdf.setFillColor(backgroundColor);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
  };

  fillPageBackground();
  pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    position = margin - (imgHeight - heightLeft);
    pdf.addPage();
    fillPageBackground();
    pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  return pdf.output('blob');
}

export async function savePdfBlob(blob: Blob, options: MarkdownPdfSaveOptions): Promise<string | null> {
  const name = options.defaultFilename.endsWith('.pdf')
    ? options.defaultFilename
    : `${options.defaultFilename}.pdf`;

  if (window.agentx?.saveFile && window.agentx?.writeFileBytes) {
    const path = await window.agentx.saveFile({
      defaultPath: name,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!path) return null;
    const buf = await blob.arrayBuffer();
    await window.agentx.writeFileBytes(path, new Uint8Array(buf));
    return path;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return name;
}
