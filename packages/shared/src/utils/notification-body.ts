import { stripToolNoise } from './text-sanitize.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip internal agent noise from automation notification bodies.
 * Keeps user-facing markdown summary only.
 */
export function sanitizeAutomationNotificationBody(
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

  const plainTitle = opts?.title?.replace(/^[✓✗]\s*/, '').trim();
  if (plainTitle) {
    const variants = [plainTitle, `[${plainTitle}]`];
    for (const v of variants) {
      body = body.replace(new RegExp(`^${escapeRegex(v)}\\s*\\n?`, 'm'), '');
      body = body.replace(new RegExp(`^#+\\s*${escapeRegex(plainTitle)}\\s*\\n?`, 'm'), '');
    }
  }

  const headingIdx = body.search(/^#{1,3}\s/m);
  if (headingIdx > 0) {
    body = body.slice(headingIdx);
  } else {
    const summaryStart = body.search(/^[-*•]\s|\d+\.\s/m);
    if (summaryStart > 80 && summaryStart < 1200) {
      body = body.slice(summaryStart);
    }
  }

  const sections = body.split(/(?=^##\s)/m).map((s) => s.trim()).filter(Boolean);
  if (sections.length > 1 && body.length > 600) {
    const last = sections[sections.length - 1]!;
    if (last.length >= 120) body = last;
  }

  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return body || stripToolNoise(raw);
}
