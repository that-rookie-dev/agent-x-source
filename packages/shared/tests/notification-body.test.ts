import { describe, it, expect } from 'vitest';
import { sanitizeAutomationNotificationBody } from '../src/utils/notification-body.js';

describe('sanitizeAutomationNotificationBody', () => {
  it('strips tool ledger and scheduled automation echoes', () => {
    const raw = `[Scheduled automation] Daily India News Summary (7:05 AM)

Let me fetch the news.

[TURN TOOL LEDGER]
[TOOL web_search OK] results...
[/TURN TOOL LEDGER]

## India headlines

- Story one
- Story two`;

    const out = sanitizeAutomationNotificationBody(raw, { title: 'Daily India News Summary (7:05 AM)' });
    expect(out).toContain('## India headlines');
    expect(out).not.toContain('[TURN TOOL LEDGER]');
    expect(out).not.toContain('[Scheduled automation]');
    expect(out).not.toContain('Let me fetch');
  });

  it('strips echoed bracketed title', () => {
    const raw = `[Daily India News Summary (7:05 AM)]

## Summary

All clear.`;
    const out = sanitizeAutomationNotificationBody(raw, { title: 'Daily India News Summary (7:05 AM)' });
    expect(out).toBe('## Summary\n\nAll clear.');
  });
});
