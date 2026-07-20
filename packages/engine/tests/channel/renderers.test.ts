import { describe, it, expect } from 'vitest';
import { TelegramRenderer } from '../../src/channels/renderers/TelegramRenderer.js';
import { SlackRenderer } from '../../src/channels/renderers/SlackRenderer.js';
import { DiscordRenderer } from '../../src/channels/renderers/DiscordRenderer.js';
import { EmailRenderer } from '../../src/channels/renderers/EmailRenderer.js';
import type { ChannelContentBlock } from '@agentx/shared';

// ─────────────────────────────────────────────────────────────
// Telegram Renderer
// ─────────────────────────────────────────────────────────────

describe('TelegramRenderer', () => {
  const renderer = new TelegramRenderer();

  it('has correct channel and max length', () => {
    expect(renderer.channel).toBe('telegram');
    expect(renderer.maxMessageLength).toBe(4096);
  });

  it('renders a simple text block', () => {
    const results = renderer.renderBlocks([{ type: 'text', text: 'Hello world' }]);
    expect(results).toHaveLength(1);
    const payload = results[0]!.payload as { text: string; parse_mode: string };
    expect(payload.parse_mode).toBe('MarkdownV2');
    expect(payload.text).toContain('Hello');
  });

  it('renders a code block with language', () => {
    const results = renderer.renderBlocks([
      { type: 'code', language: 'ts', code: 'const x = 1;' },
    ]);
    expect(results).toHaveLength(1);
    const payload = results[0]!.payload as { text: string };
    expect(payload.text).toContain('```ts');
    expect(payload.text).toContain('const x = 1;');
  });

  it('renders choices as inline keyboard buttons', () => {
    const results = renderer.renderBlocks([
      { type: 'choices', prompt: 'Pick one', options: [
        { label: 'Option A', value: 'a' },
        { label: 'Option B', value: 'b', recommended: true },
      ] },
    ]);
    expect(results).toHaveLength(1);
    const payload = results[0]!.payload as { reply_markup: { inline_keyboard: unknown[] } };
    expect(payload.reply_markup).toBeDefined();
    expect(payload.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
    expect(results[0]!.callbackData).toBeDefined();
    expect(results[0]!.callbackData!.length).toBe(2);
  });

  it('renders URL buttons when option has url', () => {
    const results = renderer.renderBlocks([
      { type: 'choices', prompt: 'Open link', options: [
        { label: 'Visit', value: 'visit', url: 'https://example.com' },
      ] },
    ]);
    const payload = results[0]!.payload as { reply_markup: { inline_keyboard: Array<Array<Record<string, string>>> } };
    const button = payload.reply_markup.inline_keyboard[0]![0]!;
    expect(button.url).toBe('https://example.com');
    expect(button.callback_data).toBeUndefined();
    // URL buttons don't generate callback data
    expect(results[0]!.callbackData?.length ?? 0).toBe(0);
  });

  it('renders status blocks with emoji', () => {
    const results = renderer.renderBlocks([
      { type: 'status', icon: '✅', text: 'Task completed' },
    ]);
    const payload = results[0]!.payload as { text: string };
    expect(payload.text).toContain('✅');
    expect(payload.text).toContain('Task completed');
  });

  it('converts tables to vertical lists (no table support)', () => {
    const results = renderer.renderBlocks([
      { type: 'table', headers: ['Name', 'Age'], rows: [['Alice', '30']] },
    ]);
    const payload = results[0]!.payload as { text: string };
    // Should not contain pipe table syntax
    expect(payload.text).not.toMatch(/^\|/m);
    expect(payload.text).toContain('Alice');
    expect(payload.text).toContain('Name');
  });

  it('chunks long text exceeding 4096 chars', () => {
    const longText = 'A'.repeat(5000);
    const results = renderer.renderBlocks([{ type: 'text', text: longText }]);
    expect(results.length).toBeGreaterThan(1);
    for (const result of results) {
      const payload = result.payload as { text: string };
      expect(payload.text.length).toBeLessThanOrEqual(4096);
    }
  });

  it('renders embed blocks as formatted text', () => {
    const results = renderer.renderBlocks([
      { type: 'embed', title: 'My Embed', description: 'Some description', fields: [
        { name: 'Field 1', value: 'Value 1', inline: true },
      ] },
    ]);
    expect(results).toHaveLength(1);
    const payload = results[0]!.payload as { text: string };
    expect(payload.text).toContain('My Embed');
    expect(payload.text).toContain('Some description');
    expect(payload.text).toContain('Field 1');
  });

  it('renderMarkdown parses and renders markdown text', () => {
    const results = renderer.renderMarkdown('# Hello\n\nSome text');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const payload = results[0]!.payload as { text: string };
    expect(payload.text).toContain('Hello');
  });
});

// ─────────────────────────────────────────────────────────────
// Slack Renderer
// ─────────────────────────────────────────────────────────────

describe('SlackRenderer', () => {
  const renderer = new SlackRenderer();

  it('has correct channel and max length', () => {
    expect(renderer.channel).toBe('slack');
    expect(renderer.maxMessageLength).toBe(3000);
  });

  it('renders text as a section block', () => {
    const results = renderer.renderBlocks([{ type: 'text', text: 'Hello Slack' }]);
    expect(results).toHaveLength(1);
    const payload = results[0]!.payload as { blocks: Array<{ type: string; text: { type: string; text: string } }> };
    expect(payload.blocks[0]!.type).toBe('section');
    expect(payload.blocks[0]!.text.type).toBe('mrkdwn');
    expect(payload.blocks[0]!.text.text).toBe('Hello Slack');
  });

  it('renders headers as header blocks', () => {
    const results = renderer.renderBlocks([{ type: 'header', level: 1, text: 'Title' }]);
    const payload = results[0]!.payload as { blocks: Array<{ type: string }> };
    expect(payload.blocks[0]!.type).toBe('header');
  });

  it('renders dividers as divider blocks', () => {
    const results = renderer.renderBlocks([{ type: 'divider' }]);
    const payload = results[0]!.payload as { blocks: Array<{ type: string }> };
    expect(payload.blocks[0]!.type).toBe('divider');
  });

  it('renders choices as action buttons', () => {
    const results = renderer.renderBlocks([
      { type: 'choices', prompt: 'Choose', options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b', recommended: true },
      ] },
    ]);
    const payload = results[0]!.payload as { blocks: Array<{ type: string; elements?: unknown[] }> };
    // Should have a section for the prompt and an actions block for buttons
    const actionBlocks = payload.blocks.filter((b) => b.type === 'actions');
    expect(actionBlocks.length).toBe(1);
    expect(results[0]!.callbackData).toBeDefined();
    expect(results[0]!.callbackData!.length).toBe(2);
  });

  it('renders choices as select menu when >25 options', () => {
    const options = Array.from({ length: 30 }, (_, i) => ({
      label: `Option ${i + 1}`,
      value: `opt_${i}`,
    }));
    const results = renderer.renderBlocks([
      { type: 'choices', prompt: 'Pick one', options },
    ]);
    const payload = results[0]!.payload as { blocks: Array<{ type: string; accessory?: { type: string } }> };
    const sectionWithSelect = payload.blocks.find(
      (b) => b.type === 'section' && b.accessory?.type === 'static_select',
    );
    expect(sectionWithSelect).toBeDefined();
    expect(results[0]!.callbackData!.length).toBe(30);
  });

  it('renders tables as mrkdwn pipe tables', () => {
    const results = renderer.renderBlocks([
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
    ]);
    const payload = results[0]!.payload as { blocks: Array<{ text: { text: string } }> };
    expect(payload.blocks[0]!.text.text).toContain('| A | B |');
    expect(payload.blocks[0]!.text.text).toContain('| 1 | 2 |');
  });

  it('renders embed blocks as sections with fields', () => {
    const results = renderer.renderBlocks([
      { type: 'embed', title: 'Embed Title', description: 'Desc', fields: [
        { name: 'F1', value: 'V1', inline: true },
      ] },
    ]);
    const payload = results[0]!.payload as { blocks: Array<{ type: string }> };
    expect(payload.blocks.length).toBeGreaterThan(1);
    expect(payload.blocks.some((b) => b.type === 'section')).toBe(true);
  });

  it('applies button styles (primary/danger)', () => {
    const results = renderer.renderBlocks([
      { type: 'choices', prompt: 'Choose', options: [
        { label: 'Go', value: 'go', style: 'primary' },
        { label: 'Stop', value: 'stop', style: 'danger' },
      ] },
    ]);
    const payload = results[0]!.payload as { blocks: Array<{ type: string; elements?: Array<{ style?: string }> }> };
    const actionsBlock = payload.blocks.find((b) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock!.elements![0]!.style).toBe('primary');
    expect(actionsBlock!.elements![1]!.style).toBe('danger');
  });
});

// ─────────────────────────────────────────────────────────────
// Discord Renderer
// ─────────────────────────────────────────────────────────────

describe('DiscordRenderer', () => {
  const renderer = new DiscordRenderer();

  it('has correct channel and max length', () => {
    expect(renderer.channel).toBe('discord');
    expect(renderer.maxMessageLength).toBe(2000);
  });

  it('renders text as content', () => {
    const results = renderer.renderBlocks([{ type: 'text', text: 'Hello Discord' }]);
    expect(results).toHaveLength(1);
    const payload = results[0]!.payload as { content: string };
    expect(payload.content).toBe('Hello Discord');
  });

  it('renders code blocks with language hint', () => {
    const results = renderer.renderBlocks([
      { type: 'code', language: 'python', code: 'print("hi")' },
    ]);
    const payload = results[0]!.payload as { content: string };
    expect(payload.content).toContain('```python');
    expect(payload.content).toContain('print("hi")');
  });

  it('renders choices as button components', () => {
    const results = renderer.renderBlocks([
      { type: 'choices', prompt: 'Choose', options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b', recommended: true },
      ] },
    ]);
    const payload = results[0]!.payload as { components: Array<{ type: number; components: Array<{ type: number; style: number }> }> };
    expect(payload.components).toBeDefined();
    expect(payload.components.length).toBeGreaterThan(0);
    // First button should be Secondary (2), second should be Success (3) for recommended
    const buttons = payload.components[0]!.components;
    expect(buttons[0]!.style).toBe(2); // secondary
    expect(buttons[1]!.style).toBe(3); // success (recommended)
  });

  it('renders choices as select menu when >25 options', () => {
    const options = Array.from({ length: 30 }, (_, i) => ({
      label: `Option ${i + 1}`,
      value: `opt_${i}`,
    }));
    const results = renderer.renderBlocks([
      { type: 'choices', prompt: 'Pick one', options },
    ]);
    const payload = results[0]!.payload as { components: Array<{ type: number; components: Array<{ type: number }> }> };
    // Should have a select menu (type 3) in the components
    const selectRow = payload.components.find(
      (row) => row.components.some((c) => c.type === 3),
    );
    expect(selectRow).toBeDefined();
  });

  it('renders embed blocks as Discord embeds', () => {
    const results = renderer.renderBlocks([
      { type: 'embed', title: 'Embed Title', description: 'Description', color: 0xff0000, fields: [
        { name: 'Field', value: 'Value', inline: false },
      ] },
    ]);
    const payload = results[0]!.payload as { embeds: Array<{ title: string; description: string; color: number; fields: Array<{ name: string; value: string; inline: boolean }> }> };
    expect(payload.embeds).toBeDefined();
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0]!.title).toBe('Embed Title');
    expect(payload.embeds[0]!.color).toBe(0xff0000);
    expect(payload.embeds[0]!.fields).toHaveLength(1);
  });

  it('applies button styles correctly', () => {
    const results = renderer.renderBlocks([
      { type: 'choices', prompt: 'Choose', options: [
        { label: 'Primary', value: 'p', style: 'primary' },
        { label: 'Danger', value: 'd', style: 'danger' },
      ] },
    ]);
    const payload = results[0]!.payload as { components: Array<{ components: Array<{ style: number }> }> };
    expect(payload.components[0]!.components[0]!.style).toBe(1); // Primary
    expect(payload.components[0]!.components[1]!.style).toBe(4); // Danger
  });

  it('chunks long text exceeding 2000 chars', () => {
    const longText = 'A'.repeat(3000);
    const results = renderer.renderBlocks([{ type: 'text', text: longText }]);
    expect(results.length).toBeGreaterThan(1);
    for (const result of results) {
      const payload = result.payload as { content: string };
      expect(payload.content.length).toBeLessThanOrEqual(2000);
    }
  });

  it('renders tables as code blocks (no native table support)', () => {
    const results = renderer.renderBlocks([
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
    ]);
    const payload = results[0]!.payload as { content: string };
    // Should be in a code block
    expect(payload.content).toContain('```');
    expect(payload.content).toContain('A');
    expect(payload.content).toContain('1');
  });
});

// ─────────────────────────────────────────────────────────────
// Email Renderer
// ─────────────────────────────────────────────────────────────

describe('EmailRenderer', () => {
  const renderer = new EmailRenderer();

  it('has correct channel', () => {
    expect(renderer.channel).toBe('email');
  });

  it('renders text as HTML paragraph', () => {
    const results = renderer.renderBlocks([{ type: 'text', text: 'Hello Email' }]);
    expect(results).toHaveLength(1);
    const payload = results[0]!.payload as { html: string };
    expect(payload.html).toContain('<p>');
    expect(payload.html).toContain('Hello Email');
    expect(payload.html).toContain('</p>');
  });

  it('renders code blocks with <pre><code> tags', () => {
    const results = renderer.renderBlocks([
      { type: 'code', language: 'js', code: 'console.log(1);' },
    ]);
    const payload = results[0]!.payload as { html: string };
    expect(payload.html).toContain('<pre>');
    expect(payload.html).toContain('<code');
    expect(payload.html).toContain('console.log(1);');
  });

  it('renders headers as <h1>/<h2>/<h3> tags', () => {
    const results = renderer.renderBlocks([
      { type: 'header', level: 1, text: 'Title' },
      { type: 'header', level: 2, text: 'Subtitle' },
    ]);
    const payload = results[0]!.payload as { html: string };
    expect(payload.html).toContain('<h1>Title</h1>');
    expect(payload.html).toContain('<h2>Subtitle</h2>');
  });

  it('renders tables as HTML <table>', () => {
    const results = renderer.renderBlocks([
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
    ]);
    const payload = results[0]!.payload as { html: string };
    expect(payload.html).toContain('<table');
    expect(payload.html).toContain('<th>A</th>');
    expect(payload.html).toContain('<td>1</td>');
  });

  it('renders lists as <ul>/<ol>', () => {
    const results = renderer.renderBlocks([
      { type: 'list', ordered: false, items: ['a', 'b'] },
      { type: 'list', ordered: true, items: ['x', 'y'] },
    ]);
    const payload = results[0]!.payload as { html: string };
    expect(payload.html).toContain('<ul>');
    expect(payload.html).toContain('<li>a</li>');
    expect(payload.html).toContain('<ol>');
    expect(payload.html).toContain('<li>x</li>');
  });

  it('renders embed blocks as styled callout divs', () => {
    const results = renderer.renderBlocks([
      { type: 'embed', title: 'Alert', description: 'Something happened', color: 0xff0000, fields: [
        { name: 'Severity', value: 'High', inline: true },
      ] },
    ]);
    const payload = results[0]!.payload as { html: string };
    expect(payload.html).toContain('Alert');
    expect(payload.html).toContain('Something happened');
    expect(payload.html).toContain('Severity');
    expect(payload.html).toContain('border-left');
  });

  it('renders links as <a> tags', () => {
    const results = renderer.renderBlocks([
      { type: 'link', text: 'Click', url: 'https://example.com' },
    ]);
    const payload = results[0]!.payload as { html: string };
    expect(payload.html).toContain('<a href="https://example.com">Click</a>');
  });

  it('escapes HTML special characters', () => {
    const results = renderer.renderBlocks([
      { type: 'text', text: '<script>alert("xss")</script>' },
    ]);
    const payload = results[0]!.payload as { html: string };
    expect(payload.html).toContain('&lt;script&gt;');
    expect(payload.html).not.toContain('<script>');
  });
});

// ─────────────────────────────────────────────────────────────
// Renderer Registry
// ─────────────────────────────────────────────────────────────

describe('Renderer Registry', () => {
  it('getRenderer returns correct renderer per channel', async () => {
    const { getRenderer } = await import('../../src/channels/renderers/index.js');
    expect(getRenderer('telegram').channel).toBe('telegram');
    expect(getRenderer('slack').channel).toBe('slack');
    expect(getRenderer('discord').channel).toBe('discord');
    expect(getRenderer('email').channel).toBe('email');
  });

  it('getRenderer caches renderer instances', async () => {
    const { getRenderer } = await import('../../src/channels/renderers/index.js');
    const r1 = getRenderer('telegram');
    const r2 = getRenderer('telegram');
    expect(r1).toBe(r2); // same instance
  });
});
