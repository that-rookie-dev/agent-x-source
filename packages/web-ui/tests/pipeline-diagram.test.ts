import { describe, it, expect } from 'vitest';
import { normalizeAssistantMarkdown } from '../src/chat/markdown-normalize';
import {
  expandCollapsedPipeline,
  parsePipelineDiagram,
  formatPipelineForCopy,
  isPipelineDiagramContent,
  repairPlainPipelineFences,
} from '../src/chat/pipeline-diagram';

const PIPELINE_SNIPPET = `### **PRODUCTION STACK** (Sub-1 Second RTT)

A real-world example achieving **<1 second round-trip latency** on an 8GB laptop without GPU:

\`\`\`
STT: Vosk (50-100ms)
  ↓
LLM: Gemma 3:1B via Ollama (300-500ms)
  ↓
TTS: Piper (100ms)
──────────────────────
Total: ~500-700ms latency
\`\`\``;

const COLLAPSED_INLINE =
  'STT: Vosk (50-100ms) ↓ LLM: Gemma 3:1B via Ollama (300-500ms) ↓ TTS: Piper (100ms) ────────────────────── Total: ~500-700ms latency';

describe('pipeline diagram parsing', () => {
  it('detects pipeline content with arrows', () => {
    expect(isPipelineDiagramContent(COLLAPSED_INLINE)).toBe(true);
    expect(isPipelineDiagramContent('Your AI Platform ├── Core')).toBe(false);
  });

  it('expands collapsed inline pipeline onto separate lines', () => {
    const expanded = expandCollapsedPipeline(COLLAPSED_INLINE);
    expect(expanded).toContain('\n↓\n');
    expect(expanded).toContain('STT: Vosk (50-100ms)');
    expect(expanded).toContain('Total:');
  });

  it('parses steps, timings, and footer', () => {
    const diagram = parsePipelineDiagram(COLLAPSED_INLINE);
    expect(diagram.steps).toHaveLength(3);
    expect(diagram.steps[0]).toEqual({ label: 'STT: Vosk', timing: '50-100ms' });
    expect(diagram.steps[1]?.label).toContain('Gemma 3:1B');
    expect(diagram.steps[2]?.timing).toBe('100ms');
    expect(diagram.footer).toBe('~500-700ms latency');
  });

  it('normalizes irregular spacing in multiline fenced block', () => {
    const messy = `\`\`\`
STT: Vosk (50-100ms)
↓
  LLM: Gemma 3:1B via Ollama (300-500ms)
   ↓
TTS: Piper (100ms)
──────────────────────
Total: ~500-700ms latency
\`\`\``;
    const retagged = repairPlainPipelineFences(messy);
    expect(retagged).toContain('```pipeline');
    const body = retagged.match(/```pipeline\n([\s\S]*?)```/)?.[1] ?? '';
    const diagram = parsePipelineDiagram(body);
    expect(diagram.steps).toHaveLength(3);
    expect(formatPipelineForCopy(diagram)).toContain('↓');
  });

  it('retags session production stack fence as pipeline', () => {
    const normalized = normalizeAssistantMarkdown(PIPELINE_SNIPPET);
    expect(normalized).toContain('```pipeline');
    expect(normalized).toContain('STT: Vosk (50-100ms)');
    expect(normalized).toMatch(/```pipeline[\s\S]*──────────────────────[\s\S]*```/);
  });

  it('preserves box-drawing separator inside pipeline fence (not HR split)', () => {
    const normalized = normalizeAssistantMarkdown(PIPELINE_SNIPPET);
    expect(normalized).not.toMatch(/```pipeline[\s\S]*\n---\n[\s\S]*Total:/);
  });
});
