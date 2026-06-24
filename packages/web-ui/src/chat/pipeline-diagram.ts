import { isTreeDiagramContent } from './tree-diagram.js';

/** Vertical / sequential flow arrows (not tree box-drawing). */
const PIPELINE_ARROW = /(?:↓|→|➜|⇒|->)/;
const ARROW_ONLY_LINE = /^(?:\s|[↓→➜⇒]|->|—|–|-|=)+$/;
const SEPARATOR_LINE = /^[\s─\-–—_=]{4,}$/;
const TIMING_SUFFIX = /^(.+?)\s*\(([^)]+)\)\s*$/;

export interface PipelineStep {
  label: string;
  timing?: string;
}

export interface PipelineDiagram {
  steps: PipelineStep[];
  footer?: string;
}

export function isPipelineDiagramContent(text: string): boolean {
  if (!text || isTreeDiagramContent(text)) return false;
  if (!PIPELINE_ARROW.test(text)) return false;
  const segments = text.split(PIPELINE_ARROW).map((s) => s.trim()).filter(Boolean);
  if (segments.length >= 2) return true;
  return /[A-Za-z][\w\s]*:\s*.+/.test(text);
}

/** Split collapsed inline pipelines onto separate lines. */
export function expandCollapsedPipeline(text: string): string {
  if (!PIPELINE_ARROW.test(text)) return text;

  let out = text.replace(/\r\n/g, '\n').trim();

  // Footer glued to last step: `... (100ms) ─── Total: ~500ms`
  out = out.replace(
    /\s+([─\-–—_=]{4,})\s*(Total\s*:\s*.+)/gi,
    '\n$1\n$2',
  );

  const expanded: string[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const arrowParts = trimmed
      .split(/\s+(?:↓|→|➜|⇒|->)\s+/)
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

function parseStepLine(line: string): PipelineStep | null {
  const cleaned = line.replace(/^(?:\s|[↓→➜⇒]|->)+/, '').trim();
  if (!cleaned || ARROW_ONLY_LINE.test(cleaned) || SEPARATOR_LINE.test(cleaned)) return null;

  const timingMatch = cleaned.match(TIMING_SUFFIX);
  if (timingMatch) {
    return { label: timingMatch[1]!.trim(), timing: timingMatch[2]!.trim() };
  }
  return { label: cleaned };
}

/** Parse raw pipeline text into structured steps + optional total footer. */
export function parsePipelineDiagram(raw: string): PipelineDiagram {
  const expanded = expandCollapsedPipeline(raw);
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
      footer = line.replace(/^total\s*:\s*/i, '').trim() || line.trim();
      pastSeparator = true;
      continue;
    }

    const step = parseStepLine(line);
    if (step) steps.push(step);
  }

  return { steps, footer };
}

/** Canonical multiline text for clipboard copy. */
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

/** Normalize body before re-tagging as ```pipeline. */
export function normalizePipelineBody(body: string): string {
  const diagram = parsePipelineDiagram(body);
  if (diagram.steps.length === 0) return expandCollapsedPipeline(body);
  return formatPipelineForCopy(diagram);
}

/** Re-tag plain ``` fences that contain flow arrows as ```pipeline blocks. */
export function repairPlainPipelineFences(content: string): string {
  if (!content || !content.includes('```') || !PIPELINE_ARROW.test(content)) return content;

  return content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang: string, body: string) => {
    const language = (lang || '').toLowerCase();
    if (language === 'pipeline' || language === 'flow') return match;
    if (language === 'tree' || language === 'diagram') return match;
    if (isTreeDiagramContent(body)) return match;
    if (!isPipelineDiagramContent(body)) return match;
    return `\`\`\`pipeline\n${normalizePipelineBody(body)}\n\`\`\``;
  });
}

/** Wrap unfenced inline pipeline paragraphs in ```pipeline fences. */
export function repairPipelineDiagrams(content: string): string {
  if (!content || !PIPELINE_ARROW.test(content)) return content;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    if (buf.length === 0) return;
    const joined = buf.join('\n').trim();
    if (isPipelineDiagramContent(joined) && !isTreeDiagramContent(joined)) {
      out.push('```pipeline');
      out.push(normalizePipelineBody(joined));
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

    if (PIPELINE_ARROW.test(trimmed) && !trimmed.startsWith('#') && !trimmed.startsWith('|')) {
      buf.push(line);
      continue;
    }

    if (buf.length > 0 && (SEPARATOR_LINE.test(trimmed) || /^total\s*:/i.test(trimmed))) {
      buf.push(line);
      continue;
    }

    flush();
    out.push(line);
  }

  flush();
  return out.join('\n');
}
