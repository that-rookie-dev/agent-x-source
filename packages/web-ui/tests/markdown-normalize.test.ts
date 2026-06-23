import { describe, it, expect } from 'vitest';
import { normalizeAssistantMarkdown, repairMarkdownTables } from '../src/chat/markdown-normalize';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

function rendersTable(md: string): boolean {
  const normalized = normalizeAssistantMarkdown(md);
  const html = renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, normalized),
  );
  return html.includes('<table');
}

describe('repairMarkdownTables', () => {
  it('fixes separator column count mismatch from session e717f518 STT table', () => {
    const broken = `### **SPEECH-TO-TEXT (STT)**

| Model | Latency | RAM | WER* | Key Strengths |
|--------|---------|-----|---------------|
| **Vosk** | <200ms | 50-100MB | Moderate | Tiny |`;

    expect(rendersTable(broken)).toBe(true);
  });

  it('expands collapsed table rows on one line', () => {
    const collapsed =
      '| Model | Latency | |-------|---------| | Vosk | fast |';
    const repaired = repairMarkdownTables(collapsed);
    expect(repaired.split('\n').length).toBeGreaterThan(1);
    expect(rendersTable(repaired)).toBe(true);
  });

  it('repairs broken ALL CAPS heading so following table parses', () => {
    const broken = `SPEECH-TO-TEXT (STT)**

| Model | Latency |
|-------|---------|
| Vosk | fast |`;
    expect(rendersTable(broken)).toBe(true);
  });

  it('does not insert separator rows between every data row', () => {
    const table = `| Time | Activity |
| --- | --- |
| 6:30 AM | Wake up |
| 7:00 AM | Breakfast |
| 12:00 PM | Lunch |`;
    const repaired = repairMarkdownTables(table);
    expect(repaired).not.toMatch(/\|\s*---\s*\|\s*---\s*\|[\s\S]*\|\s*---\s*\|\s*---\s*\|/);
    const html = renderToStaticMarkup(
      React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, normalizeAssistantMarkdown(table)),
    );
    const rowCount = (html.match(/<tr/g) ?? []).length;
    expect(rowCount).toBe(4); // header + 3 data rows
  });

  it('strips spurious separator rows between data rows from LLM output', () => {
    const broken = `| Time | Activity |
| --- | --- |
| 6:30 AM | Wake up, hydrate |
| --- | --- |
| 7:00 AM | Breakfast |
| --- | --- |
| 12:00 PM | Lunch |`;
    const repaired = repairMarkdownTables(broken);
    expect(repaired.split('\n').filter(isSeparatorRowLike)).toHaveLength(1);
    const html = renderToStaticMarkup(
      React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, normalizeAssistantMarkdown(broken)),
    );
    const rowCount = (html.match(/<tr/g) ?? []).length;
    expect(rowCount).toBe(4);
  });
});

function isSeparatorRowLike(line: string): boolean {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}
