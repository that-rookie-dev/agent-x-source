import { describe, it, expect } from 'vitest';
import { ResponseFormatter } from '../src/agent/ResponseFormatter.js';

describe('ResponseFormatter', () => {
  describe('static format', () => {
    it('parses plain text', () => {
      const segments = ResponseFormatter.format('Hello world');
      expect(segments).toHaveLength(1);
      expect(segments[0]!.type).toBe('text');
      expect(segments[0]!.content).toBe('Hello world');
    });

    it('parses headings', () => {
      const segments = ResponseFormatter.format('# Title\n## Subtitle');
      expect(segments).toHaveLength(2);
      expect(segments[0]!.type).toBe('heading');
      expect(segments[0]!.content).toBe('Title');
      expect(segments[1]!.type).toBe('heading');
      expect(segments[1]!.content).toBe('Subtitle');
    });

    it('parses code blocks', () => {
      const input = '```typescript\nconst x = 1;\n```';
      const segments = ResponseFormatter.format(input);
      expect(segments.some((s) => s.type === 'code')).toBe(true);
      const code = segments.find((s) => s.type === 'code')!;
      expect(code.language).toBe('typescript');
      expect(code.content).toBe('const x = 1;');
    });

    it('parses list items', () => {
      const segments = ResponseFormatter.format('- item one\n- item two');
      expect(segments).toHaveLength(2);
      expect(segments[0]!.type).toBe('list');
      expect(segments[1]!.type).toBe('list');
    });
  });

  describe('streaming', () => {
    it('processes chunks incrementally', () => {
      const formatter = new ResponseFormatter();

      const s1 = formatter.processChunk('Hello ');
      expect(s1).toHaveLength(0); // no newline yet

      const s2 = formatter.processChunk('world\n');
      expect(s2).toHaveLength(1);
      expect(s2[0]!.content).toBe('Hello world');
    });

    it('flush returns remaining buffer', () => {
      const formatter = new ResponseFormatter();
      formatter.processChunk('partial text');
      const flushed = formatter.flush();
      expect(flushed).toHaveLength(1);
      expect(flushed[0]!.content).toBe('partial text');
    });
  });
});
