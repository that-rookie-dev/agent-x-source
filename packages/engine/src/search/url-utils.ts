const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal',
]);

/** RFC1918, loopback, link-local, and metadata-style hosts blocked for SSRF. */
export function isUrlSafeForFetch(url: string): boolean {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(u.hostname.toLowerCase())) return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (/^0\./.test(host)) return false;
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
    // Block decimal/hex/octal IP encodings (e.g. http://2130706433)
    if (/^\d+$/.test(host)) return false;
    if (/^0x[0-9a-f]+$/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Throws when URL is not safe for server-side fetch. */
export function assertSafeFetchUrl(url: string): void {
  if (!isUrlSafeForFetch(url)) {
    throw new Error(`URL blocked by SSRF policy: ${url}`);
  }
}

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    let path = u.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function markdownSourceLink(url: string): string {
  const domain = extractDomain(url);
  return domain ? `[${domain}](${url})` : url;
}

export function prefixWebExtractOutput(url: string, body: string): string {
  const source = markdownSourceLink(url);
  return `Source: ${source}\n\n${body}`;
}

export function faviconUrlForDomain(domain: string): string {
  if (!domain) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}
