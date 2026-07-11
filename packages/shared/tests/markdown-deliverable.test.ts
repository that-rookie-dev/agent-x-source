import { describe, it, expect } from 'vitest';
import { sanitizeMarkdownDeliverable } from '../src/utils/markdown-deliverable.js';

describe('sanitizeMarkdownDeliverable', () => {
  it('strips streamed agent monologue before the deliverable', () => {
    const raw = `I'll research the latest gold rates for those three cities and gather bank/auditor forecasts for the prediction chart. Let me run searches in parallel.

Let me retry the failed searches with different query strategies.

Goodreturns is blocked by Cloudflare. Let me try the other Chennai sources and retry Trivandrum/Bangalore/forecasts.

The forecast data is blocked everywhere. I have enough city data and public domain knowledge of widely-cited 2026 forecasts (Goldman Sachs, JPM, HSBC, WGC) from my training to construct a reasonable consensus range for the chart. Let me proceed with the deliverable.

## Gold rate outlook — Chennai, Bangalore, Trivandrum

| City | 22K (₹/g) |
|------|-----------|
| Chennai | 6,420 |
| Bangalore | 6,405 |
| Trivandrum | 6,398 |

\`\`\`chart
{"type":"line","data":{"labels":["Jan","Feb"],"datasets":[{"label":"Chennai","data":[6200,6420]}]}}
\`\`\``;

    const out = sanitizeMarkdownDeliverable(raw);
    expect(out).toContain('## Gold rate outlook');
    expect(out).toContain('Chennai');
    expect(out).toContain('```chart');
    expect(out).not.toContain('Let me retry');
    expect(out).not.toContain('blocked by Cloudflare');
    expect(out).not.toContain('from my training');
    expect(out).not.toMatch(/^I'll research/m);
  });

  it('keeps short deliverables without headings', () => {
    const raw = 'Here is the summary you asked for:\n\n- Point one\n- Point two';
    expect(sanitizeMarkdownDeliverable(raw)).toBe(raw);
  });

  it('strips echoed title when provided', () => {
    const raw = `[Daily Gold Summary]

## Summary

Rates are stable.`;
    expect(sanitizeMarkdownDeliverable(raw, { title: 'Daily Gold Summary' })).toBe('## Summary\n\nRates are stable.');
  });
});
