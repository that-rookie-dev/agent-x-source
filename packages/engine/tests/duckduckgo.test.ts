import { describe, it, expect } from 'vitest';
import { parseDuckDuckGoHtml } from '../src/search/providers/duckduckgo.js';

const SAMPLE_HTML = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://timesofindia.indiatimes.com/city/bangalore">Bengaluru News</a>
    </h2>
    <a class="result__snippet" href="https://timesofindia.indiatimes.com/city/bangalore">Latest <b>Bangalore</b> headlines and updates.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://www.deccanherald.com/bengaluru">Deccan Herald Bengaluru</a>
    </h2>
    <a class="result__snippet" href="https://www.deccanherald.com/bengaluru">Get the latest Bengaluru news updates.</a>
  </div>
</div>
`;

describe('parseDuckDuckGoHtml', () => {
  it('parses web-result blocks with titles, urls, and snippets', () => {
    const hits = parseDuckDuckGoHtml(SAMPLE_HTML, 10);
    expect(hits.length).toBe(2);
    expect(hits[0]!.title).toBe('Bengaluru News');
    expect(hits[0]!.url).toContain('timesofindia.indiatimes.com');
    expect(hits[0]!.snippet).toContain('Bangalore');
    expect(hits[0]!.provider).toBe('duckduckgo');
  });

  it('returns empty on bot challenge pages', () => {
    expect(parseDuckDuckGoHtml('<div class="anomaly-modal">bots</div>')).toEqual([]);
  });
});
