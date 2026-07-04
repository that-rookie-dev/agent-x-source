import { describe, expect, it } from 'vitest';
import {
  attachMissingSourceChipsToLists,
  chipLabelForSource,
  domainFromUrl,
  linkifyAllBareUrlsInMarkdown,
  prepareWebSourcedMarkdown,
  shouldRenderAsSourceChip,
} from '../src/chat/source-chip-utils';
import { collectWebSourceUrls } from '../src/chat/web-source-urls';

describe('source-chip-utils', () => {
  it('extracts short domain labels', () => {
    expect(domainFromUrl('https://www.bbc.co.uk/news/article')).toBe('bbc.co.uk');
    expect(domainFromUrl('https://reuters.com/world')).toBe('reuters.com');
  });

  it('linkifies bare URLs anywhere in list items', () => {
    const input = '- See also https://reuters.com/markets and https://bbc.com/news';
    const out = linkifyAllBareUrlsInMarkdown(input);
    expect(out).toContain('[reuters.com](https://reuters.com/markets)');
    expect(out).toContain('[bbc.com](https://bbc.com/news');
  });

  it('linkifies inline bare URLs in prose', () => {
    const input = 'Markets moved (https://ft.com/markets) on the news.';
    const out = linkifyAllBareUrlsInMarkdown(input);
    expect(out).toContain('[ft.com](https://ft.com/markets)');
  });

  it('appends missing chips to list items from known sources', () => {
    const input = '- Headline one\n- Headline two';
    const sources = ['https://reuters.com/a', 'https://bbc.com/b'];
    const out = attachMissingSourceChipsToLists(input, sources);
    expect(out).toContain('- Headline one [reuters.com](https://reuters.com/a)');
    expect(out).toContain('- Headline two [bbc.com](https://bbc.com/b)');
  });

  it('prepareWebSourcedMarkdown combines linkify and attach', () => {
    const out = prepareWebSourcedMarkdown('- Story A\n- Story B https://nytimes.com/x', ['https://wsj.com/y']);
    expect(out).toContain('[nytimes.com](https://nytimes.com/x)');
    expect(out).toContain('[wsj.com](https://wsj.com/y)');
  });

  it('prefers domain for numeric citation labels', () => {
    expect(chipLabelForSource('https://nytimes.com/a', '1')).toBe('nytimes.com');
  });

  it('mandates chips for all http links', () => {
    expect(shouldRenderAsSourceChip('https://example.com', 'anything')).toBe(true);
    expect(shouldRenderAsSourceChip('mailto:x@y.com', 'x')).toBe(false);
  });
});

describe('collectWebSourceUrls', () => {
  it('collects urls from web_search tool output and metadata', () => {
    const urls = collectWebSourceUrls([
      {
        id: 't1',
        type: 'tool',
        tool: {
          id: 'c1',
          name: 'web_search',
          status: 'done',
          result: '1. Title\n   snippet\n   Source: [reuters.com](https://reuters.com/a)',
          metadata: { sources: ['https://reuters.com/a', 'https://bbc.com/b'] },
        },
      },
      {
        id: 'x1',
        type: 'text',
        content: '- News item',
      },
    ]);
    expect(urls).toEqual(['https://reuters.com/a', 'https://bbc.com/b']);
  });
});
