import { describe, it, expect } from 'vitest';
import { extractMarkdownFromLegacyTsx, normalizeMarkdownDocumentInput } from '../src/utils/markdown-document-input.js';

describe('extractMarkdownFromLegacyTsx', () => {
  it('extracts JSON-stringified markdown from auto-wrapped shell', () => {
    const md = '# Report\n\n- item one\n- item two';
    const tsx = `import { CanvasRoot, Section, Markdown } from '@agentx/canvas';
export default function SavedCanvas() {
  return (
    <CanvasRoot>
      <Section title="Report">
        <Markdown>${JSON.stringify(md)}</Markdown>
      </Section>
    </CanvasRoot>
  );
}`;
    expect(extractMarkdownFromLegacyTsx(tsx)).toBe(md);
  });

  it('extracts template literal markdown', () => {
    const tsx = '<Markdown>{`## Notes\\n\\nHello`}</Markdown>';
    expect(extractMarkdownFromLegacyTsx(tsx)).toBe('## Notes\n\nHello');
  });
});

describe('normalizeMarkdownDocumentInput', () => {
  it('prefers explicit markdown and strips agent monologue', () => {
    const raw = `Let me gather the data.

## Hello

World`;
    expect(normalizeMarkdownDocumentInput({ contentMarkdown: raw })).toBe('## Hello\n\nWorld');
  });

  it('wraps unknown TSX as fenced source', () => {
    const tsx = 'export default function X() { return null; }';
    const out = normalizeMarkdownDocumentInput({ contentTsx: tsx, title: 'Ops' });
    expect(out).toContain('# Ops');
    expect(out).toContain('```tsx');
    expect(out).toContain(tsx);
  });
});
