import { stripToolNoise } from './text-sanitize.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Opening phrases typical of streamed agent process narration (not user-facing output). */
const AGENT_MONOLOGUE_OPENING =
  /^(?:let me\b|i(?:'ll| will|'ve| have| need| am|'m going to)\b|now i\b|good(?:\s*[-,]|returns)|the (?:page|search|forecast|forecast data)\b|search pipeline\b|attempting\b|retrying\b)/i;

/** In-paragraph cues that the block is internal agent conversation, not deliverable content. */
const AGENT_MONOLOGUE_CUES =
  /\b(?:blocked by cloudflare|failing everywhere|from my training|slight discrepancy|targeted scraping|alternate sources?|different query strategies?|proceed with the deliverable|html chrome|known (?:direct )?urls?|known research)\b/i;

function isDeliverableParagraph(paragraph: string): boolean {
  const t = paragraph.trim();
  if (!t) return false;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/^```/.test(t)) return true;
  if (/^[-*•]\s+\S/.test(t)) return true;
  if (/^\d+\.\s+\S/.test(t)) return true;
  if (/^\|[^\n|]+\|/.test(t)) return true;
  if (/^>\s/.test(t) && t.length > 100) return true;
  return false;
}

function isAgentMonologueParagraph(paragraph: string): boolean {
  const t = paragraph.trim();
  if (!t || isDeliverableParagraph(t)) return false;
  if (AGENT_MONOLOGUE_OPENING.test(t)) return true;
  if (AGENT_MONOLOGUE_CUES.test(t)) return true;
  if (
    /^(?:i|we)\b/i.test(t)
    && /\b(?:try|retry|fetch|get|search|extract|proceed|gather|need|research)\b/i.test(t)
    && t.length < 420
  ) {
    return true;
  }
  return false;
}

function stripLeadingMonologue(body: string): string {
  const paragraphs = body.split(/\n{2,}/);
  let start = 0;
  while (start < paragraphs.length && isAgentMonologueParagraph(paragraphs[start]!)) {
    start += 1;
  }
  if (start === 0) return body;
  return paragraphs.slice(start).join('\n\n');
}

function stripEchoedTitle(body: string, title?: string): string {
  const plainTitle = title?.replace(/^[✓✗]\s*/, '').trim();
  if (!plainTitle) return body;
  const variants = [plainTitle, `[${plainTitle}]`];
  let out = body;
  for (const v of variants) {
    out = out.replace(new RegExp(`^${escapeRegex(v)}\\s*\\n?`, 'm'), '');
    out = out.replace(new RegExp(`^#+\\s*${escapeRegex(plainTitle)}\\s*\\n?`, 'm'), '');
  }
  return out;
}

/**
 * Strip internal agent conversation from markdown before save/export.
 * Keeps headings, lists, tables, charts, and polished deliverable prose only.
 */
export function sanitizeMarkdownDeliverable(
  raw: string,
  opts?: { title?: string },
): string {
  if (!raw?.trim()) return '';

  let body = stripToolNoise(raw, { trim: false });

  body = body.replace(/\[TURN TOOL LEDGER\][\s\S]*?\[\/TURN TOOL LEDGER\]/gi, '');
  body = body.replace(/\[TEAM UPDATE[^\]]*\][\s\S]*?\[\/TEAM UPDATE\]/gi, '');
  body = body.replace(/^\[Scheduled automation\][^\n]*\n?/gim, '');
  body = body.replace(/^\[TOOL [^\n]+\n?/gim, '');
  body = body.replace(/^\[STEP \d+[^\n]*\n?/gim, '');
  body = body.replace(/^\[SYSTEM\][^\n]*\n?/gim, '');

  body = stripEchoedTitle(body, opts?.title);
  body = stripLeadingMonologue(body);

  const headingIdx = body.search(/^#{1,3}\s/m);
  if (headingIdx > 0) {
    const preamble = body.slice(0, headingIdx).trim();
    if (!preamble || preamble.split(/\n{2,}/).every(isAgentMonologueParagraph)) {
      body = body.slice(headingIdx);
    }
  } else {
    const chartIdx = body.search(/^```chart\b/m);
    if (chartIdx > 0) {
      const preamble = body.slice(0, chartIdx).trim();
      if (preamble.split(/\n{2,}/).every(isAgentMonologueParagraph)) {
        body = body.slice(chartIdx);
      }
    }
  }

  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return body || stripToolNoise(raw);
}
