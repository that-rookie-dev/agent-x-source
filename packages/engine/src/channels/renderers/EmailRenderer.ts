/**
 * Email renderer — converts ChannelContentBlock[] into styled HTML.
 *
 * Email supports full HTML: tables, headings, links, styled code blocks.
 * No character limit (practical limit ~100KB for most clients).
 */
import type {
  ChannelContentBlock,
  ChannelRenderResult,
  ChannelRenderer,
} from '@agentx/shared';
import type { ChannelBindingId } from '@agentx/shared';
import { markdownToBlocks } from './markdown-parser.js';

/** Escape HTML special characters. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convert simple inline markdown to HTML (bold, italic, code, links). */
function inlineMarkdownToHtml(text: string): string {
  let result = escapeHtml(text);
  // Code spans
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>');
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return result;
}

/** Render a single block to HTML. */
function renderBlock(block: ChannelContentBlock): string {
  switch (block.type) {
    case 'text':
      return `<p>${inlineMarkdownToHtml(block.text)}</p>`;

    case 'code': {
      const langClass = block.language ? ` class="language-${block.language}"` : '';
      return `<pre><code${langClass}>${escapeHtml(block.code)}</code></pre>`;
    }

    case 'header': {
      const tag = `h${block.level}`;
      return `<${tag}>${escapeHtml(block.text)}</${tag}>`;
    }

    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }

    case 'quote':
      return `<blockquote>${inlineMarkdownToHtml(block.text)}</blockquote>`;

    case 'divider':
      return '<hr>';

    case 'status':
      return `<p style="margin:4px 0;"><span style="font-size:1.1em;">${block.icon}</span> ${escapeHtml(block.text)}</p>`;

    case 'table': {
      const headerCells = block.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
      const bodyRows = block.rows.map((row) => {
        const cells = row.map((c) => `<td>${escapeHtml(c)}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table style="border-collapse:collapse;width:100%;"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    }

    case 'link':
      return `<p><a href="${block.url}">${escapeHtml(block.text)}</a></p>`;

    case 'choices': {
      const items = block.options.map((opt, i) =>
        `<li>${i + 1}. ${escapeHtml(opt.label)}${opt.recommended ? ' (recommended)' : ''}${opt.url ? ` — <a href="${opt.url}">Open</a>` : ''}</li>`,
      ).join('');
      return `<p>${escapeHtml(block.prompt)}</p><ol>${items}</ol><p style="color:#666;font-size:0.9em;">Reply with the number of your choice.</p>`;
    }

    case 'embed': {
      const parts: string[] = [];
      const titleHtml = block.url
        ? `<h3><a href="${block.url}">${escapeHtml(block.title)}</a></h3>`
        : `<h3>${escapeHtml(block.title)}</h3>`;
      parts.push(`<div style="border-left:4px solid #${(block.color ?? 0x5865f2).toString(16).padStart(6, '0')};padding:12px 16px;margin:16px 0;background:#f9f9f9;border-radius:4px;">`);
      parts.push(titleHtml);
      if (block.description) parts.push(`<p>${inlineMarkdownToHtml(block.description)}</p>`);
      if (block.fields) {
        for (const field of block.fields) {
          if (field.inline) {
            parts.push(`<span style="display:inline-block;margin-right:16px;"><strong>${escapeHtml(field.name)}</strong>: ${inlineMarkdownToHtml(field.value)}</span>`);
          } else {
            parts.push(`<p><strong>${escapeHtml(field.name)}</strong><br>${inlineMarkdownToHtml(field.value)}</p>`);
          }
        }
      }
      if (block.footer) parts.push(`<p style="color:#666;font-size:0.85em;">${escapeHtml(block.footer)}</p>`);
      parts.push('</div>');
      return parts.join('\n');
    }

    default:
      return '';
  }
}

/** HTML email template wrapper. */
function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:680px;margin:0 auto;padding:16px;">
${body}
</body>
</html>`;
}

export class EmailRenderer implements ChannelRenderer {
  readonly channel: ChannelBindingId = 'email';
  readonly maxMessageLength = 100_000;

  renderBlocks(blocks: ChannelContentBlock[]): ChannelRenderResult[] {
    const body = blocks.map(renderBlock).join('\n');
    const html = wrapHtml(body);
    return [{
      payload: { html, text: blocks.map((b) => b.type === 'text' ? b.text : '').join('\n') },
      needsChunking: false,
    }];
  }

  renderMarkdown(text: string): ChannelRenderResult[] {
    return this.renderBlocks(markdownToBlocks(text));
  }
}
