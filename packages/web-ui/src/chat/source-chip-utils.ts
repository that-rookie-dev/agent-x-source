import type React from 'react';

const BARE_URL = /https?:\/\/[^\s)\]>]+/g;
const LIST_PREFIX = /^(\s*(?:[-*+]|•|\d+\.)\s+)(.+)$/;
const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^)]+)\)/;
const MARKDOWN_LINK_GLOBAL = /\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;

export function domainFromUrl(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href.replace(/^https?:\/\//, '').slice(0, 24);
  }
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(BARE_URL)) {
    const raw = match[0]!;
    const url = raw.replace(/[.,;:!?)]+$/g, '');
    if (!url.startsWith('http') || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  for (const match of text.matchAll(MARKDOWN_LINK_GLOBAL)) {
    const url = match[1]!;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function chipLabelForSource(href: string, label: string): string {
  const domain = domainFromUrl(href);
  const text = label.trim();
  if (!text || text === href) return domain;
  if (/^\[?\d+\]?$/.test(text)) return domain;
  if (/^source\s*\d+$/i.test(text)) return domain;
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    if (text === host || text.startsWith(host)) return domain;
  } catch { /* ignore */ }
  if (!/\s/.test(text) && text.length <= 32) return text;
  if (text.length <= 36) return text;
  return domain.length <= 28 ? domain : `${domain.slice(0, 26)}…`;
}

/** All http(s) anchor targets render as source chips — mandatory for web data. */
export function shouldRenderAsSourceChip(href: string | undefined, _children?: React.ReactNode): boolean {
  return !!href?.startsWith('http');
}

function lineHasSourceReference(line: string): boolean {
  return MARKDOWN_LINK.test(line) || BARE_URL.test(line);
}

function splitTrailingPunctuation(url: string): { url: string; suffix: string } {
  const trimmed = url.replace(/[.,;:!?)]+$/g, '');
  return { url: trimmed, suffix: url.slice(trimmed.length) };
}

function linkifyBareUrlsInSegment(segment: string): string {
  return segment.replace(BARE_URL, (raw) => {
    const { url, suffix } = splitTrailingPunctuation(raw);
    if (!url.startsWith('http')) return raw;
    return `[${domainFromUrl(url)}](${url})${suffix}`;
  });
}

/** Replace every bare URL outside code fences with [domain](url) chip markdown. */
export function linkifyAllBareUrlsInMarkdown(content: string): string {
  if (!content || !BARE_URL.test(content)) return content;
  BARE_URL.lastIndex = 0;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;

  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    const parts: string[] = [];
    let cursor = 0;
    MARKDOWN_LINK_GLOBAL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_LINK_GLOBAL.exec(line)) !== null) {
      if (match.index > cursor) {
        parts.push(linkifyBareUrlsInSegment(line.slice(cursor, match.index)));
      }
      parts.push(match[0]!);
      cursor = match.index + match[0]!.length;
    }
    if (cursor < line.length) parts.push(linkifyBareUrlsInSegment(line.slice(cursor)));
    return parts.length ? parts.join('') : line;
  }).join('\n');
}

/** Append source chips to list lines that cite web data but lack a URL. */
export function attachMissingSourceChipsToLists(content: string, sourceUrls: string[]): string {
  if (!sourceUrls.length || !content) return content;

  const queue = [...sourceUrls];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;

  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    const listMatch = line.match(LIST_PREFIX);
    if (!listMatch) return line;

    const body = listMatch[2]!;
    if (lineHasSourceReference(body)) return line;

    const url = queue.shift();
    if (!url) return line;

    const domain = domainFromUrl(url);
    return `${listMatch[1]}${body.trimEnd()} [${domain}](${url})`;
  }).join('\n');
}

/**
 * Mandatory web-source preparation for assistant markdown:
 * 1) linkify all bare URLs
 * 2) attach chips to list items missing sources (from tool results)
 */
export function prepareWebSourcedMarkdown(content: string, knownSourceUrls: string[] = []): string {
  if (!content) return content;
  let out = linkifyAllBareUrlsInMarkdown(content);
  if (knownSourceUrls.length) {
    out = attachMissingSourceChipsToLists(out, knownSourceUrls);
  }
  return out;
}

/** @deprecated use prepareWebSourcedMarkdown */
export function injectSourceLinksInMarkdown(content: string): string {
  return prepareWebSourcedMarkdown(content);
}
