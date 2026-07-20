export interface DeriveMarkdownTitleInput {
  title?: string;
  contentTsx?: string;
  contentMarkdown?: string;
}

const GENERIC_TITLES = new Set([
  'canvas',
  'markdown',
  'untitled',
  'untitled canvas',
  'untitled markdown',
  'saved message',
  'saved canvas',
  'saved markdown',
  'savedcanvas',
  'new canvas',
  'my canvas',
  'document',
  'report',
]);

export function isGenericMarkdownTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  return !normalized || GENERIC_TITLES.has(normalized);
}

function humanizeComponentName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function cleanTitleCandidate(raw: string): string | null {
  const title = raw
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .slice(0, 200);
  if (!title || isGenericMarkdownTitle(title)) return null;
  return title;
}

function titleFromTsx(content: string): string | null {
  const sectionPatterns = [
    /<Section[^>]*\btitle\s*=\s*["']([^"']+)["']/i,
    /<Section[^>]*\btitle\s*=\s*\{\s*["']([^"']+)["']\s*\}/i,
    /<Section[^>]*\btitle\s*=\s*\{\s*`([^`]+)`\s*\}/i,
    /<Card[^>]*\btitle\s*=\s*["']([^"']+)["']/i,
  ];
  for (const pattern of sectionPatterns) {
    const match = content.match(pattern);
    const candidate = match?.[1] ? cleanTitleCandidate(match[1]) : null;
    if (candidate) return candidate;
  }

  const fnMatch = content.match(/export\s+default\s+function\s+(\w+)/);
  if (fnMatch?.[1] && fnMatch[1] !== 'SavedCanvas') {
    const candidate = cleanTitleCandidate(humanizeComponentName(fnMatch[1]));
    if (candidate) return candidate;
  }

  const chartTitleMatch = content.match(/["']title["']\s*:\s*["']([^"']+)["']/i)
    ?? content.match(/["']title["']\s*:\s*`([^`]+)`/i);
  if (chartTitleMatch?.[1]) {
    const candidate = cleanTitleCandidate(chartTitleMatch[1]);
    if (candidate) return candidate;
  }

  return null;
}

function titleFromChartFence(content: string): string | null {
  const fence = content.match(/```chart\s*([\s\S]*?)```/i);
  if (!fence?.[1]) return null;
  try {
    const spec = JSON.parse(fence[1].trim()) as { title?: unknown };
    if (typeof spec.title === 'string') {
      return cleanTitleCandidate(spec.title);
    }
  } catch {
    const inline = fence[1].match(/["']title["']\s*:\s*["']([^"']+)["']/i);
    if (inline?.[1]) return cleanTitleCandidate(inline[1]);
  }
  return null;
}

function titleFromMarkdown(content: string): string | null {
  const chartTitle = titleFromChartFence(content);
  if (chartTitle) return chartTitle;

  const heading = content.match(/^#{1,3}\s+(.+)$/m);
  if (heading?.[1]) {
    const candidate = cleanTitleCandidate(heading[1]);
    if (candidate) return candidate;
  }

  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!plain) return null;

  const sentence = plain.split(/(?<=[.!?])\s+/)[0] ?? plain;
  const words = sentence.split(' ').filter(Boolean).slice(0, 10).join(' ');
  return cleanTitleCandidate(words);
}

/** Derive a human-readable markdown document title from explicit title and/or content. */
export function deriveMarkdownTitle(input: DeriveMarkdownTitleInput): string {
  const explicit = input.title?.trim();
  if (explicit && !isGenericMarkdownTitle(explicit)) {
    return explicit.slice(0, 200);
  }

  const tsx = input.contentTsx?.trim();
  if (tsx) {
    const fromTsx = titleFromTsx(tsx);
    if (fromTsx) return fromTsx;
  }

  const markdown = input.contentMarkdown?.trim();
  if (markdown) {
    const fromMarkdown = titleFromMarkdown(markdown);
    if (fromMarkdown) return fromMarkdown;
  }

  if (tsx) {
    const fromWrapped = titleFromMarkdown(tsx);
    if (fromWrapped) return fromWrapped;
  }

  if (explicit) return explicit.slice(0, 200);
  return 'Markdown';
}
