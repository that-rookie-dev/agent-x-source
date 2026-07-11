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

/** Inline computed rgb colors so html2canvas never parses color()/color-mix() from stylesheets. */
function inlineComputedColorsForPdf(cloneRoot: HTMLElement, sourceRoot: HTMLElement): void {
  const win = cloneRoot.ownerDocument.defaultView;
  if (!win) return;

  const pairs: Array<[Element, Element]> = [[sourceRoot, cloneRoot]];
  const sourceNodes = sourceRoot.querySelectorAll('*');
  const cloneNodes = cloneRoot.querySelectorAll('*');
  for (let i = 0; i < sourceNodes.length; i++) {
    pairs.push([sourceNodes[i]!, cloneNodes[i]!]);
  }

  for (const [src, clone] of pairs) {
    if (!(src instanceof HTMLElement) || !(clone instanceof HTMLElement)) continue;
    const computed = win.getComputedStyle(src);
    for (const prop of PDF_COLOR_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value) clone.style.setProperty(prop, value);
    }
    const boxShadow = computed.boxShadow;
    if (boxShadow && boxShadow !== 'none') {
      clone.style.boxShadow = boxShadow;
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

  const canvas = await html2canvas(root, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: getComputedStyle(root).backgroundColor || '#ffffff',
    windowWidth: root.scrollWidth,
    windowHeight: root.scrollHeight,
    onclone: (doc) => {
      const cloneRoot = doc.querySelector('[data-markdown-export-root]');
      if (cloneRoot instanceof HTMLElement) {
        inlineComputedColorsForPdf(cloneRoot, root);
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

  pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    position = margin - (imgHeight - heightLeft);
    pdf.addPage();
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
