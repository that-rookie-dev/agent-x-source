import { isTreeDiagramContent } from './tree-diagram.js';

/** Vertical sequential flow (latency stacks). Horizontal → in bullets is not a pipeline. */
const VERTICAL_ARROW = /↓/;
const VERTICAL_ARROW_SPLIT = /\s+↓\s+/;
const HORIZONTAL_ARROW = /(?:→|➜|⇒|->)/;
const HORIZONTAL_ARROW_SPLIT = /\s*(?:→|➜|⇒|->)\s*/;
const ARROW_ONLY_LINE = /^(?:\s|[↓→➜⇒]|->)+$/;
const SEPARATOR_LINE = /^[\s─\-–—_=]{4,}$/;
const TIMING_SUFFIX = /^(.+?)\s*\(([^)]+)\)\s*$/;
const STACK_LABEL = /^[A-Za-z][\w\s]*:\s*.+/;
const BULLET_LINE = /^[-*+]\s+/;
const QA_BULLET = /^[-*+]\s+\*\*.+\*\*.*→/;

export interface PipelineStep {
  label: string;
  timing?: string;
}

export interface PipelineDiagram {
  steps: PipelineStep[];
  footer?: string;
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[-*+]\s+/, '')
    .trim();
}

export function formatPipelineStepLabel(label: string): string {
  return stripMarkdownInline(label);
}

function isBulletListContent(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const bulletLines = lines.filter((l) => BULLET_LINE.test(l) || QA_BULLET.test(l));
  return bulletLines.length >= Math.max(1, Math.ceil(lines.length * 0.5));
}

function countStackLabels(text: string): number {
  return text
    .split(/\s+↓\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => STACK_LABEL.test(stripMarkdownInline(s)))
    .length;
}

export function isPipelineDiagramContent(text: string): boolean {
  if (!text || isTreeDiagramContent(text)) return false;
  if (isBulletListContent(text)) return false;

  // Latency / processing stacks use vertical ↓ between named stages.
  if (VERTICAL_ARROW.test(text)) {
    const segments = text.split(VERTICAL_ARROW).map((s) => s.trim()).filter(Boolean);
    if (segments.length >= 2) {
      const stackish = countStackLabels(text) >= 2 || segments.some((s) => TIMING_SUFFIX.test(s));
      if (stackish) return true;
    }
    if (countStackLabels(text) >= 2) return true;
  }

  // Collapsed inline stack without newlines: `STT: ... (ms) ↓ LLM: ...`
  if (VERTICAL_ARROW_SPLIT.test(text) && countStackLabels(text) >= 2) return true;

  // Explicit flow fence body already normalized
  if (/^total\s*:/im.test(text) && countStackLabels(text) >= 1 && VERTICAL_ARROW.test(text)) return true;

  return false;
}

/** Horizontal stage chains (→), not bullet Q&A lists. */
export function isHorizontalPipelineContent(text: string): boolean {
  if (!text || isTreeDiagramContent(text) || isBulletListContent(text)) return false;
  if (VERTICAL_ARROW.test(text)) return false;
  if (!HORIZONTAL_ARROW.test(text)) return false;

  const parts = text.split(HORIZONTAL_ARROW_SPLIT).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return false;

  const stackish = parts.filter((s) => STACK_LABEL.test(stripMarkdownInline(s))).length;
  return stackish >= 2 || parts.some((s) => TIMING_SUFFIX.test(s));
}

/** Split collapsed inline pipelines onto separate lines (vertical flow only). */
export function expandCollapsedPipeline(text: string): string {
  if (!VERTICAL_ARROW.test(text)) return text;

  let out = text.replace(/\r\n/g, '\n').trim();

  out = out.replace(
    /\s+([─\-–—_=]{4,})\s*(Total\s*:\s*.+)/gi,
    '\n$1\n$2',
  );

  const expanded: string[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const arrowParts = trimmed
      .split(VERTICAL_ARROW_SPLIT)
      .map((p) => p.trim())
      .filter(Boolean);

    if (arrowParts.length > 1) {
      for (let i = 0; i < arrowParts.length; i++) {
        if (i > 0) expanded.push('↓');
        expanded.push(arrowParts[i]!);
      }
      continue;
    }

    expanded.push(trimmed);
  }

  return expanded.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Split collapsed horizontal pipelines onto separate lines. */
export function expandHorizontalPipeline(text: string): string {
  if (!HORIZONTAL_ARROW.test(text)) return text;

  let out = text.replace(/\r\n/g, '\n').trim();
  out = out.replace(
    /\s+([─\-–—_=]{4,})\s*(Total\s*:\s*.+)/gi,
    '\n$1\n$2',
  );

  const expanded: string[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const arrowParts = trimmed
      .split(HORIZONTAL_ARROW_SPLIT)
      .map((p) => p.trim())
      .filter(Boolean);

    if (arrowParts.length > 1) {
      for (let i = 0; i < arrowParts.length; i++) {
        if (i > 0) expanded.push('→');
        expanded.push(arrowParts[i]!);
      }
      continue;
    }

    expanded.push(trimmed);
  }

  return expanded.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseStepLine(line: string): PipelineStep | null {
  const cleaned = stripMarkdownInline(line.replace(/^(?:[↓→➜⇒]|->)\s*/, '').trim());
  if (!cleaned || ARROW_ONLY_LINE.test(cleaned) || SEPARATOR_LINE.test(cleaned)) return null;

  const timingMatch = cleaned.match(TIMING_SUFFIX);
  if (timingMatch) {
    return {
      label: formatPipelineStepLabel(timingMatch[1]!),
      timing: timingMatch[2]!.trim(),
    };
  }
  return { label: formatPipelineStepLabel(cleaned) };
}

/** Parse raw pipeline text into structured steps + optional total footer. */
export function parsePipelineDiagram(raw: string): PipelineDiagram {
  const expanded = VERTICAL_ARROW.test(raw)
    ? expandCollapsedPipeline(raw)
    : expandHorizontalPipeline(raw);
  const lines = expanded.split('\n').map((l) => l.trim()).filter(Boolean);

  const steps: PipelineStep[] = [];
  let footer: string | undefined;
  let pastSeparator = false;

  for (const line of lines) {
    if (ARROW_ONLY_LINE.test(line)) continue;

    if (SEPARATOR_LINE.test(line)) {
      pastSeparator = true;
      continue;
    }

    if (pastSeparator || /^total\s*:/i.test(line)) {
      footer = stripMarkdownInline(line.replace(/^total\s*:\s*/i, '').trim() || line.trim());
      pastSeparator = true;
      continue;
    }

    const step = parseStepLine(line);
    if (step) steps.push(step);
  }

  return { steps, footer };
}

/** Canonical multiline text for clipboard copy (vertical flow). */
export function formatPipelineForCopy(diagram: PipelineDiagram): string {
  const lines: string[] = [];
  for (let i = 0; i < diagram.steps.length; i++) {
    const s = diagram.steps[i]!;
    lines.push(s.timing ? `${s.label} (${s.timing})` : s.label);
    if (i < diagram.steps.length - 1) lines.push('↓');
  }
  if (diagram.footer) {
    lines.push('──────────────────────');
    lines.push(`Total: ${diagram.footer}`);
  }
  return lines.join('\n');
}

/** Canonical multiline text for horizontal pipeline copy. */
export function formatHorizontalPipelineForCopy(diagram: PipelineDiagram): string {
  const lines: string[] = [];
  for (let i = 0; i < diagram.steps.length; i++) {
    const s = diagram.steps[i]!;
    lines.push(s.timing ? `${s.label} (${s.timing})` : s.label);
    if (i < diagram.steps.length - 1) lines.push('→');
  }
  if (diagram.footer) {
    lines.push('──────────────────────');
    lines.push(`Total: ${diagram.footer}`);
  }
  return lines.join('\n');
}

/** Normalize body before re-tagging as ```flow. */
export function normalizeFlowBody(body: string): string {
  const diagram = parsePipelineDiagram(body);
  if (diagram.steps.length === 0) return expandCollapsedPipeline(body);
  return formatPipelineForCopy(diagram);
}

/** Normalize body before re-tagging as ```pipeline. */
export function normalizeHorizontalPipelineBody(body: string): string {
  const diagram = parsePipelineDiagram(body);
  if (diagram.steps.length === 0) return expandHorizontalPipeline(body);
  return formatHorizontalPipelineForCopy(diagram);
}

/** @deprecated Use normalizeFlowBody */
export function normalizePipelineBody(body: string): string {
  return normalizeFlowBody(body);
}

/** Re-tag plain ``` fences that contain flow arrows as ```flow / ```pipeline blocks. */
export function repairPlainPipelineFences(content: string): string {
  if (!content || !content.includes('```')) return content;
  if (!VERTICAL_ARROW.test(content) && !HORIZONTAL_ARROW.test(content)) return content;

  return content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang: string, body: string) => {
    const language = (lang || '').toLowerCase();
    if (language === 'pipeline' || language === 'flow') return match;
    if (language === 'tree' || language === 'diagram') return match;
    if (isTreeDiagramContent(body)) return match;
    if (isPipelineDiagramContent(body)) {
      return `\`\`\`flow\n${normalizeFlowBody(body)}\n\`\`\``;
    }
    if (isHorizontalPipelineContent(body)) {
      return `\`\`\`pipeline\n${normalizeHorizontalPipelineBody(body)}\n\`\`\``;
    }
    return match;
  });
}

function isPipelineCandidateLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || BULLET_LINE.test(trimmed) || QA_BULLET.test(trimmed)) return false;
  if (VERTICAL_ARROW.test(trimmed)) return true;
  if (SEPARATOR_LINE.test(trimmed) || /^total\s*:/i.test(trimmed)) return true;
  return STACK_LABEL.test(stripMarkdownInline(trimmed)) && TIMING_SUFFIX.test(trimmed);
}

/** Wrap unfenced inline pipeline paragraphs in ```pipeline fences. */
export function repairPipelineDiagrams(content: string): string {
  if (!content || !VERTICAL_ARROW.test(content)) return content;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    if (buf.length === 0) return;
    const joined = buf.join('\n').trim();
    if (isPipelineDiagramContent(joined) && !isTreeDiagramContent(joined)) {
      out.push('```flow');
      out.push(normalizeFlowBody(joined));
      out.push('```');
    } else {
      out.push(...buf);
    }
    buf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (isPipelineCandidateLine(trimmed) && !trimmed.startsWith('#') && !trimmed.startsWith('|')) {
      buf.push(line);
      continue;
    }

    flush();
    out.push(line);
  }

  flush();
  return out.join('\n');
}
