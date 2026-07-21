/**
 * Strict filters for auto-seeding TodoManager from assistant text.
 * Only planned, actionable checklist items — never summary bullets / findings.
 */

const NON_TASK_CONTEXT_RE =
  /\b(key points?|takeaways?|findings?|summary|summarize|overview|notes?|observation|analysis|insights?|recap|highlights?|here(?:'s| is) what|in short|tl;dr)\b/i;

const ACTION_SECTION_RE =
  /^(?:#{1,6}\s*)?(?:next steps?|action items?|actions?|todo(?:s)?|to-?dos?|checklist|plan|tasks?|work items?)\s*:?\s*$/i;

const IMPERATIVE_START_RE =
  /^(?:please\s+|then\s+|also\s+)?(?:implement|add|create|fix|update|write|run|deploy|investigate|verify|check|review|refactor|migrate|test|build|install|configure|enable|disable|remove|delete|rename|move|copy|open|close|set|send|ask|schedule|document|draft|prepare|outline|research|compare|analyze|analyse|integrate|wire|hook|ship|merge|rebase|bump|publish|release)\b/i;

const NON_ACTIONABLE_RE =
  /\b(?:already|saves?|saved|was|were|is the right|quite|solid|normal|correctly|deducted|preferred|preferable|recommended regime|take-home|net is)\b/i;

const AMOUNT_LED_RE = /^[\d₹$€£¥%]/;

const CHECKBOX_RE = /^\s*[-*•]\s+\[\s?\]\s+(.+)$/i;
const TODO_PREFIX_RE = /^\s*(?:TODO|ACTION|TASK)\s*:\s*(.+)$/i;
const LIST_ITEM_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/;

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function isActionableTitle(title: string): boolean {
  if (title.length < 8 || title.length > 160) return false;
  if (NON_ACTIONABLE_RE.test(title)) return false;
  if (AMOUNT_LED_RE.test(title) || /\b₹[\d,]+\b/.test(title)) return false;
  // Prefer imperative / work-shaped lines; allow checkbox/TODO-prefixed even if softer.
  return IMPERATIVE_START_RE.test(title) || /^(?:make|do|get|put|ensure|confirm|finish|complete)\b/i.test(title);
}

/**
 * Extract only planned actionable todo titles from assistant content.
 * Returns [] when the content looks like a summary/findings list.
 */
export function extractActionableTaskTitles(content: string): string[] {
  if (!content.trim()) return [];
  const hasActionSection = content.split('\n').some((l) => ACTION_SECTION_RE.test(l.trim()));
  if (NON_TASK_CONTEXT_RE.test(content) && !hasActionSection) {
    // Still allow explicit checkboxes / TODO: lines even inside a broader summary doc.
    return extractExplicitMarkers(content);
  }

  const lines = content.split('\n');
  const out: string[] = [];
  let inActionSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      inActionSection = false;
      continue;
    }
    if (ACTION_SECTION_RE.test(line)) {
      inActionSection = true;
      continue;
    }
    // Leaving an action section when a new markdown heading appears.
    if (/^#{1,6}\s+\S/.test(line) && !ACTION_SECTION_RE.test(line)) {
      inActionSection = false;
    }

    const checkbox = CHECKBOX_RE.exec(line);
    if (checkbox) {
      const title = stripMarkdown(checkbox[1]!);
      if (title.length >= 5 && title.length < 200 && !NON_ACTIONABLE_RE.test(title)) {
        out.push(title);
      }
      continue;
    }

    const todoPrefixed = TODO_PREFIX_RE.exec(line);
    if (todoPrefixed) {
      const title = stripMarkdown(todoPrefixed[1]!);
      if (title.length >= 5 && title.length < 200 && !NON_ACTIONABLE_RE.test(title)) {
        out.push(title);
      }
      continue;
    }

    if (!inActionSection) continue;

    const list = LIST_ITEM_RE.exec(line);
    if (!list) continue;
    const title = stripMarkdown(list[1]!);
    if (isActionableTitle(title)) out.push(title);
  }

  return dedupe(out);
}

function extractExplicitMarkers(content: string): string[] {
  const out: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const checkbox = CHECKBOX_RE.exec(line);
    if (checkbox) {
      const title = stripMarkdown(checkbox[1]!);
      if (title.length >= 5 && title.length < 200) out.push(title);
      continue;
    }
    const todoPrefixed = TODO_PREFIX_RE.exec(line);
    if (todoPrefixed) {
      const title = stripMarkdown(todoPrefixed[1]!);
      if (title.length >= 5 && title.length < 200) out.push(title);
    }
  }
  return dedupe(out);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
