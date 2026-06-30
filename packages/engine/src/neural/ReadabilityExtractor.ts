/**
 * Lightweight readability-style HTML extractor.
 *
 * Scores paragraphs by link density and length, then returns the best block of
 * text. This avoids the overhead of a full headless browser while giving clean
 * article text for web distillation.
 */

export interface ExtractedArticle {
  title: string;
  byline: string;
  content: string;
  excerpt: string;
}

export function extractArticle(html: string, baseUrl?: string): ExtractedArticle {
  const title = extractTitle(html);
  const textBlocks = extractTextBlocks(html, baseUrl);
  const scored = textBlocks.map((b) => ({ ...b, score: scoreBlock(b) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const content = best?.text ?? textBlocks.map((b) => b.text).join('\n\n');
  const excerpt = content.slice(0, 200).replace(/\s+/g, ' ').trim();
  return { title, byline: '', content, excerpt };
}

interface TextBlock {
  text: string;
  tag: string;
  linkDensity: number;
  wordCount: number;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() ?? '';
}

function extractTextBlocks(html: string, _baseUrl?: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gi;
  let currentTag = '';
  let buffer = '';
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRegex.exec(html)) !== null) {
    const text = html.slice(lastIndex, m.index);
    if (text && currentTag) {
      buffer += ' ' + text;
    }
    const tag = m[1]!.toLowerCase();
    if (['p', 'div', 'article', 'section', 'main', 'li', 'td'].includes(tag)) {
      if (currentTag && buffer.trim()) {
        pushBlock(blocks, currentTag, buffer);
      }
      currentTag = tag;
      buffer = '';
    } else if (['script', 'style', 'nav', 'header', 'footer', 'aside'].includes(tag)) {
      if (currentTag && buffer.trim()) {
        pushBlock(blocks, currentTag, buffer);
      }
      currentTag = '';
      buffer = '';
    }
    lastIndex = tagRegex.lastIndex;
  }

  if (currentTag && buffer.trim()) {
    pushBlock(blocks, currentTag, buffer);
  }

  return blocks.filter((b) => b.wordCount > 10);
}

function pushBlock(blocks: TextBlock[], tag: string, raw: string): void {
  const text = htmlToText(raw);
  const linkChars = (raw.match(/<a\b/gi) ?? []).length * 20;
  const linkDensity = text.length > 0 ? linkChars / text.length : 1;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  blocks.push({ text, tag, linkDensity: Math.min(1, linkDensity), wordCount: words.length });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreBlock(block: TextBlock): number {
  let score = block.wordCount;
  if (block.tag === 'article' || block.tag === 'main') score *= 1.5;
  if (block.tag === 'p') score *= 1.2;
  score *= 1 - block.linkDensity;
  return score;
}
