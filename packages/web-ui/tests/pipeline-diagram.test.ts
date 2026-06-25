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

const KEY_CONSIDERATIONS = `- **CPU-only?** → Piper + Vosk (both excel on CPU)
- **Multi-language?** → Piper (40+ languages)
- **Highest accuracy?** → Whisper Tiny (larger model, slower)
- **Real-time streaming?** → Vosk (designed for streaming)
- **Limited RAM (<4GB)?** → Vosk + Piper (sub-150MB combined)`;

describe('pipeline diagram parsing', () => {
  it('detects pipeline content with arrows', () => {
    expect(isPipelineDiagramContent(COLLAPSED_INLINE)).toBe(true);
    expect(isPipelineDiagramContent('Your AI Platform ├── Core')).toBe(false);
  });

  it('does not treat bullet Q&A lists with → as pipelines', () => {
    expect(isPipelineDiagramContent(KEY_CONSIDERATIONS)).toBe(false);
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
    expect(retagged).toContain('```flow');
    const body = retagged.match(/```flow\n([\s\S]*?)```/)?.[1] ?? '';
    const diagram = parsePipelineDiagram(body);
    expect(diagram.steps).toHaveLength(3);
    expect(formatPipelineForCopy(diagram)).toContain('↓');
  });

  it('retags session production stack fence as flow', () => {
    const normalized = normalizeAssistantMarkdown(PIPELINE_SNIPPET);
    expect(normalized).toContain('```flow');
    expect(normalized).toContain('STT: Vosk (50-100ms)');
    expect(normalized).toMatch(/```flow[\s\S]*──────────────────────[\s\S]*```/);
  });

  it('preserves box-drawing separator inside flow fence (not HR split)', () => {
    const normalized = normalizeAssistantMarkdown(PIPELINE_SNIPPET);
    expect(normalized).not.toMatch(/```flow[\s\S]*\n---\n[\s\S]*Total:/);
  });

  it('leaves Key Considerations bullets as markdown list, not flow fence', () => {
    const normalized = normalizeAssistantMarkdown(`### Key Considerations\n\n${KEY_CONSIDERATIONS}`);
    expect(normalized).not.toContain('```flow');
    expect(normalized).not.toContain('```pipeline');
    expect(normalized).toContain('**CPU-only?**');
  });
});
