import type { UIMessage } from '../chat/types';
import { deriveCanvasTitle } from '@agentx/shared/browser';
import { displayContent } from '../chat/utils';

/** Serialize a chat message into markdown suitable for Canvas storage (preserves chart parts). */
export function messageToCanvasMarkdown(message: UIMessage): string {
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
  if (fromParts) return fromParts;
  return displayContent(message);
}

/** Derive a canvas title from a chat message body. */
export function deriveCanvasTitleFromMessage(message: UIMessage): string {
  const markdown = messageToCanvasMarkdown(message);
  return deriveCanvasTitle({ contentMarkdown: markdown });
}

export interface CanvasPdfSaveOptions {
  defaultFilename: string;
}

/** Capture a DOM subtree and produce a multi-page PDF blob (WYSIWYG). */
export async function exportElementToPdfBlob(root: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  // Allow charts / mermaid to finish layout
  await new Promise((r) => setTimeout(r, 400));

  const canvas = await html2canvas(root, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: getComputedStyle(root).backgroundColor || '#ffffff',
    windowWidth: root.scrollWidth,
    windowHeight: root.scrollHeight,
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

export async function savePdfBlob(blob: Blob, options: CanvasPdfSaveOptions): Promise<string | null> {
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
