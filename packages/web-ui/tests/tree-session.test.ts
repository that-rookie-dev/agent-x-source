import { describe, it, expect } from 'vitest';
import { splitMarkdownSections, normalizeAssistantMarkdown } from '../src/chat/markdown-normalize';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderToStaticMarkup } from 'react-dom/server';

// Subset of real session content (structure preserved)
const SESSION_SNIPPET = `## **Architecture I Recommend**

\`\`\`
Your AI Platform
├── Core Agent Engine
├── Voice Module (Optional but bundled)
│   ├── STT: Vosk (offline speech recognition)
│   ├── TTS: Piper (offline text-to-speech)
│   └── Audio I/O: PyAudio or similar
├── Config Manager
│   └── Auto-enable voice if dependencies detected
└── Installation Script
    └── Auto-download Vosk models + Piper voices on first run
\`\`\`

---

## **Implementation Strategy**

### **1. Bundled Installation**
\`\`\`
On first platform startup:
├── Detect if Vosk + Piper are installed
├── If missing: Auto-download models (background)
│   ├── Vosk: ~50 MB per language model
│   ├── Piper: ~20–50 MB per voice
└── Enable voice toggle in UI after download completes
\`\`\``;

describe('session architecture markdown', () => {
  it('preserves fenced multiline trees in normalized output', () => {
    const normalized = normalizeAssistantMarkdown(SESSION_SNIPPET);
    expect(normalized).toContain('```');
    expect(normalized).toContain('Your AI Platform\n├──');
    expect(normalized).not.toContain('Your AI Platform ├──');
  });

  it('section split keeps tree fences intact in a section', () => {
    const sections = splitMarkdownSections(SESSION_SNIPPET);
    const archSection = sections.find((s) => s.includes('Architecture I Recommend'));
    expect(archSection).toBeTruthy();
    expect(archSection).toContain('```');
    expect(archSection).toContain('Your AI Platform\n├──');
  });

  it('react-markdown parses fenced trees as code blocks', () => {
    const sections = splitMarkdownSections(SESSION_SNIPPET);
    const archSection = sections.find((s) => s.includes('Architecture I Recommend'))!;
    const html = renderToStaticMarkup(
      React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, archSection),
    );
    expect(html).toMatch(/<pre|<code/);
    expect(html).toContain('├──');
    expect(html).not.toContain('Your AI Platform ├──');
  });

  it('retags plain fenced trees as tree language', () => {
    const normalized = normalizeAssistantMarkdown(SESSION_SNIPPET);
    expect(normalized).toContain('```tree');
    expect(normalized).not.toMatch(/```\nYour AI Platform/);
  });
});

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

describe('pipeline / latency stack blocks', () => {
  it('preserves fenced pipeline block (dash separator must not become --- rule)', () => {
    const normalized = normalizeAssistantMarkdown(PIPELINE_SNIPPET);
    // Fence must stay intact — inner dashes must not break into HR / section split
    expect(normalized).toMatch(/```[\s\S]*──────────────────────[\s\S]*```/);
    expect(normalized).not.toMatch(/```[\s\S]*\n---\n[\s\S]*Total:/);
  });
});
