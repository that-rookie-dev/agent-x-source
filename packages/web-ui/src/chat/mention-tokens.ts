/**
 * Composer mention tokens — bracket-delimited so trailing punctuation stays outside the chip.
 *
 * Canonical (write):
 *   @file[<urlencoded-relativePath>]
 *   @folder[<urlencoded-relativePath>]   ("." = workspace root)
 *   @crew[<callsign>:<urlencoded-name>]
 *   @kb[<sourceId>:<urlencoded-name>]
 *   @template[<templateId>:<urlencoded-name>]
 *
 * Legacy (read):
 *   @file:path  @folder:path  @crew:callsign:name
 */

/** Trailing sentence/closer punctuation that must never be part of a legacy path token. */
const LEGACY_TRAILING_PUNCT_RE = /[?!,;:)\]}'"]+$/;

/**
 * Characters that end a legacy colon-form path (NOT `.` — filenames include extensions).
 * Kept as a shared fragment for split / find / complete checks.
 */
const LEGACY_PATH_BODY = '[^\\s\\[\\]?!,;:)\'"]+';

export const FILE_MENTION_RE = /@file\[([^\]]+)\]/g;
export const FOLDER_MENTION_RE = /@folder\[([^\]]+)\]/g;
export const CREW_MENTION_RE = /@crew\[([^\]\s]+)\]/g;
export const KB_MENTION_RE = /@kb\[([^\]]+)\]/g;
export const TEMPLATE_MENTION_RE = /@template\[([^\]]+)\]/g;

/**
 * Split plain text into chips + raw segments (keeps delimiters).
 * Bracket forms first; legacy colon forms stop before trailing punctuation.
 */
export const MENTION_TOKEN_SPLIT_RE = new RegExp(
  `(@file\\[[^\\]]+\\]|@folder\\[[^\\]]+\\]|@crew\\[[^\\]]+\\]|@kb\\[[^\\]]+\\]|@template\\[[^\\]]+\\]|@file:${LEGACY_PATH_BODY}|@folder:${LEGACY_PATH_BODY}|@crew:[^:\\s\\[]+:${LEGACY_PATH_BODY}|@[\\w][\\w.-]*)`,
  'g',
);

/** Same pattern for global exec (UserMentionText, etc.). */
export const MENTION_TOKEN_FIND_RE = new RegExp(MENTION_TOKEN_SPLIT_RE.source, 'g');

function decodePathPayload(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function stripLegacyTrailingPunct(path: string): string {
  return path.replace(LEGACY_TRAILING_PUNCT_RE, '');
}

export function formatFileMentionToken(relativePath: string): string {
  const path = relativePath.trim();
  return path ? `@file[${encodeURIComponent(path)}]` : '';
}

export function formatFolderMentionToken(relativePath: string): string {
  const path = relativePath.trim() || '.';
  return `@folder[${encodeURIComponent(path)}]`;
}

export function formatCrewMentionToken(callsign: string, name?: string): string {
  const cs = callsign.trim();
  const label = (name?.trim() || cs);
  return `@crew[${cs}:${encodeURIComponent(label)}]`;
}

export function formatKbMentionToken(sourceId: string, name?: string): string {
  const id = sourceId.trim();
  if (!id) return '';
  const label = (name?.trim() || id);
  return `@kb[${id}:${encodeURIComponent(label)}]`;
}

export function formatTemplateMentionToken(templateId: string, name?: string): string {
  const id = templateId.trim();
  if (!id) return '';
  const label = (name?.trim() || id);
  return `@template[${id}:${encodeURIComponent(label)}]`;
}

export function parseTemplateMentionToken(token: string): { templateId: string; name: string } | null {
  const bracket = /^@template\[([^:\]]+):([^\]]+)\]$/.exec(token);
  if (!bracket) return null;
  try {
    return { templateId: bracket[1]!, name: decodeURIComponent(bracket[2]!) };
  } catch {
    return { templateId: bracket[1]!, name: bracket[2]! };
  }
}

export function parseKbMentionToken(token: string): { sourceId: string; name: string } | null {
  const bracket = /^@kb\[([^:\]]+):([^\]]+)\]$/.exec(token);
  if (!bracket) return null;
  try {
    return { sourceId: bracket[1]!, name: decodeURIComponent(bracket[2]!) };
  } catch {
    return { sourceId: bracket[1]!, name: bracket[2]! };
  }
}

export function parseCrewMentionToken(token: string): { callsign: string; name: string } | null {
  const bracket = /^@crew\[([^:\]]+):([^\]]+)\]$/.exec(token);
  if (bracket) {
    try {
      return { callsign: bracket[1]!, name: decodeURIComponent(bracket[2]!) };
    } catch {
      return { callsign: bracket[1]!, name: bracket[2]! };
    }
  }
  // Legacy @crew:callsign:name
  const raw = token.startsWith('@crew:') ? token : token.startsWith('crew:') ? `@${token}` : '';
  const m = /^@crew:([^:\s]+):(\S+)$/.exec(raw || token);
  if (!m) return null;
  const nameRaw = stripLegacyTrailingPunct(m[2]!);
  try {
    return { callsign: m[1]!, name: decodeURIComponent(nameRaw) };
  } catch {
    return { callsign: m[1]!, name: nameRaw };
  }
}

export function parseFileMentionToken(token: string): { relativePath: string; name: string } | null {
  const bracket = /^@file\[([^\]]+)\]$/.exec(token);
  if (bracket) {
    const relativePath = decodePathPayload(bracket[1]!);
    if (!relativePath) return null;
    const name = relativePath.split(/[/\\]/).pop() || relativePath;
    return { relativePath, name };
  }
  if (!token.startsWith('@file:')) return null;
  const relativePath = stripLegacyTrailingPunct(token.slice(6));
  if (!relativePath) return null;
  const name = relativePath.split(/[/\\]/).pop() || relativePath;
  return { relativePath, name };
}

export function parseFolderMentionToken(token: string): { relativePath: string; name: string } | null {
  const bracket = /^@folder\[([^\]]+)\]$/.exec(token);
  if (bracket) {
    const relativePath = decodePathPayload(bracket[1]!);
    if (!relativePath) return null;
    const name = relativePath === '.'
      ? 'workspace'
      : (relativePath.split(/[/\\]/).pop() || relativePath);
    return { relativePath, name };
  }
  if (!token.startsWith('@folder:')) return null;
  const relativePath = stripLegacyTrailingPunct(token.slice(8));
  if (!relativePath) return null;
  const name = relativePath === '.'
    ? 'workspace'
    : (relativePath.split(/[/\\]/).pop() || relativePath);
  return { relativePath, name };
}

/** True when the trailing @… span is already a completed chip token (not an open query). */
export function isCompleteMentionToken(token: string): boolean {
  if (/^@file\[[^\]]+\]$/.test(token)) return true;
  if (/^@folder\[[^\]]+\]$/.test(token)) return true;
  if (/^@crew\[[^\]]+\]$/.test(token)) return true;
  if (/^@kb\[[^\]]+\]$/.test(token)) return true;
  if (/^@template\[[^\]]+\]$/.test(token)) return true;
  // Legacy complete tokens (colon form)
  if (new RegExp(`^@file:${LEGACY_PATH_BODY}$`).test(token)) return true;
  if (new RegExp(`^@folder:${LEGACY_PATH_BODY}$`).test(token)) return true;
  if (new RegExp(`^@crew:[^:\\s\\[]+:${LEGACY_PATH_BODY}$`).test(token)) return true;
  return false;
}

/**
 * Find an in-progress @ query at the end of `textBefore` (plain serialized prefix).
 * Skips completed @file / @folder / @crew tokens — including when the user typed
 * punctuation immediately after a closed chip (`@file[a.txt]?`).
 */
export function findActiveMentionQuery(textBefore: string): { atIdx: number; query: string } | null {
  const atIdx = textBefore.lastIndexOf('@');
  if (atIdx < 0) return null;
  const pre = atIdx === 0 ? ' ' : textBefore[atIdx - 1];
  if (!(pre === ' ' || pre === '\n' || atIdx === 0)) return null;
  const raw = textBefore.slice(atIdx);
  if (/\s/.test(raw)) return null;

  // Closed bracket chip: `@file[…]` — anything after `]` is typed text, not a query.
  if (/^@(?:file|folder|crew|kb|template)\[[^\]]+\]/.test(raw)) return null;

  if (isCompleteMentionToken(raw)) return null;

  // Legacy colon token + trailing punctuation only
  const legacy = raw.match(new RegExp(
    `^(@file:${LEGACY_PATH_BODY}|@folder:${LEGACY_PATH_BODY}|@crew:[^:\\s\\[]+:${LEGACY_PATH_BODY})([?!,;:)\\]}'"]*)$`,
  ));
  if (legacy) return null;

  return { atIdx, query: raw.slice(1) };
}
