import { describe, it, expect } from 'vitest';
import { markdownToBlocks } from '../../src/channels/renderers/markdown-parser.js';

describe('markdownToBlocks', () => {
  it('parses plain text into a text block', () => {
    const blocks = markdownToBlocks('Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'text', text: 'Hello world' });
  });

  it('parses consecutive text lines into a single text block', () => {
    const blocks = markdownToBlocks('Line 1\nLine 2\nLine 3');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'text', text: 'Line 1\nLine 2\nLine 3' });
  });

  it('parses headers at all levels', () => {
    const blocks = markdownToBlocks('# H1\n## H2\n### H3');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'header', level: 1, text: 'H1' });
    expect(blocks[1]).toEqual({ type: 'header', level: 2, text: 'H2' });
    expect(blocks[2]).toEqual({ type: 'header', level: 3, text: 'H3' });
  });

  it('parses code blocks with language', () => {
    const blocks = markdownToBlocks('```ts\nconst x = 1;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'code', language: 'ts', code: 'const x = 1;' });
  });

  it('parses code blocks without language', () => {
    const blocks = markdownToBlocks('```\nplain code\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'code', language: undefined, code: 'plain code' });
  });

  it('parses unordered lists', () => {
    const blocks = markdownToBlocks('- item 1\n- item 2\n- item 3');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'list', ordered: false, items: ['item 1', 'item 2', 'item 3'] });
  });

  it('parses ordered lists', () => {
    const blocks = markdownToBlocks('1. first\n2. second\n3. third');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'list', ordered: true, items: ['first', 'second', 'third'] });
  });

  it('parses quotes', () => {
    const blocks = markdownToBlocks('> This is a quote\n> Second line');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'quote', text: 'This is a quote\nSecond line' });
  });

  it('parses dividers', () => {
    const blocks = markdownToBlocks('Before\n---\nAfter');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: 'Before' });
    expect(blocks[1]).toEqual({ type: 'divider' });
    expect(blocks[2]).toEqual({ type: 'text', text: 'After' });
  });

  it('parses status lines with emoji icons', () => {
    const blocks = markdownToBlocks('✅ Done successfully');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'status', icon: '✅', text: 'Done successfully' });
  });

  it('parses tables', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'table',
      headers: ['Name', 'Age'],
      rows: [['Alice', '30'], ['Bob', '25']],
    });
  });

  it('parses standalone links', () => {
    const blocks = markdownToBlocks('[Click here](https://example.com)');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'link', text: 'Click here', url: 'https://example.com' });
  });

  it('handles mixed content', () => {
    const md = [
      '# Title',
      '',
      'Some text here.',
      '',
      '```js',
      'console.log("hi");',
      '```',
      '',
      '- item 1',
      '- item 2',
      '',
      '✅ All done',
    ].join('\n');
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(5);
    expect(blocks[0]!.type).toBe('header');
    expect(blocks[1]!.type).toBe('text');
    expect(blocks[2]!.type).toBe('code');
    expect(blocks[3]!.type).toBe('list');
    expect(blocks[4]!.type).toBe('status');
  });

  it('handles empty input', () => {
    expect(markdownToBlocks('')).toEqual([]);
    expect(markdownToBlocks('\n\n\n')).toEqual([]);
  });
});
