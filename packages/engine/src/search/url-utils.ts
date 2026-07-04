const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function isUrlSafeForFetch(url: string): boolean {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return false;
    if (host.endsWith('.local')) return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
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
