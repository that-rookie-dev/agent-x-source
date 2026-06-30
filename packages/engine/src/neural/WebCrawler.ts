/**
 * Live web crawler for two-tier memory hydration.
 *
 * Fetches a URL, strips HTML to plain text, and stages the raw payload in the
 * web_staging table. The MemoryPipeline later distills staged content into
 * memory nodes.
 */
import { createHash } from 'node:crypto';
import type { MemoryFabric } from './MemoryFabric.js';

export interface CrawlOptions {
  /** Maximum number of pages to crawl from the starting URL. */
  maxPages?: number;
  /** Maximum body size in bytes. */
  maxBytes?: number;
  /** Comma-separated list of URL path prefixes to stay within. */
  allowPathPrefix?: string;
  /** Timeout per request in milliseconds. */
  timeoutMs?: number;
}

export interface CrawlResult {
  url: string;
  domain: string;
  pages: number;
  stagedIds: string[];
  errors: string[];
}

export class WebCrawler {
  constructor(private fabric: MemoryFabric) {}

  async crawl(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
    const maxPages = options.maxPages ?? 1;
    const maxBytes = options.maxBytes ?? 500_000;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const seen = new Set<string>();
    const stagedIds: string[] = [];
    const errors: string[] = [];
    const queue: string[] = [startUrl];
    const startDomain = new URL(startUrl).hostname;
    const prefixes = options.allowPathPrefix ? options.allowPathPrefix.split(',').map((p) => p.trim()) : undefined;

    while (queue.length > 0 && seen.size < maxPages) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        });
        if (!response.ok) {
          errors.push(`${url}: HTTP ${response.status}`);
          continue;
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          continue;
        }
        let html = await response.text();
        if (html.length > maxBytes) html = html.slice(0, maxBytes);
        const text = this.htmlToText(html);
        const contentHash = this.hash(text);
        const domain = new URL(url).hostname;
        const title = this.extractTitle(html);
        const id = await this.fabric.stageWebPayload(url, domain, 'raw', { title, text, contentHash }, undefined);
        stagedIds.push(id);

        if (seen.size < maxPages) {
          const links = this.extractLinks(html, url);
          for (const link of links) {
            if (this.shouldFollow(link, startDomain, prefixes)) {
              queue.push(link);
            }
          }
        }
      } catch (e) {
        errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { url: startUrl, domain: startDomain, pages: seen.size, stagedIds, errors };
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match?.[1]?.trim() ?? '';
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    const regex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
      try {
        links.push(new URL(m[1]!, baseUrl).href);
      } catch {
        // ignore invalid URLs
      }
    }
    return links;
  }

  private shouldFollow(url: string, startDomain: string, prefixes?: string[]): boolean {
    const parsed = new URL(url);
    if (parsed.hostname !== startDomain) return false;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.pathname.match(/\.(pdf|jpg|jpeg|png|gif|zip|exe|dmg|svg|css|js)$/i)) return false;
    if (!prefixes) return true;
    return prefixes.some((p) => parsed.pathname.startsWith(p));
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
  }
}
