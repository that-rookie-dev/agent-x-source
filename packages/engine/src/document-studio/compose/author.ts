/**
 * Document Studio — evidence-first author compose adapter (Phase 5, spec §6.2).
 *
 * Builds a structured document from extracted facts and a master outline.
 * Honest: if no facts/evidence are present, sections are left blank rather
 * than fabricated.
 */

import { generateText } from 'ai';
import type { ComposeInput, ComposeOutput } from '../runner/PrimitiveRegistry.js';
import type { Constraint, EvidenceChunk, SectionOutline } from '../types.js';
import { tryCreateModel } from '../masters/analyzers.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function headingRegexFor(title: string): RegExp {
  return new RegExp(`^#{1,6}\\s+.*${escapeRegExp(title)}.*$`, 'im');
}

function flattenSections(sections: SectionOutline[] = []): SectionOutline[] {
  const out: SectionOutline[] = [];
  for (const s of sections) {
    out.push(s);
    if (s.children) out.push(...flattenSections(s.children));
  }
  return out;
}

function sectionTitleById(sections: SectionOutline[] = [], id: string): string | undefined {
  for (const s of flattenSections(sections)) {
    if (s.id === id) return s.title;
  }
  return undefined;
}

function findHeadingIndex(lines: string[], title: string, sectionId?: string): number {
  const titleLower = title.toLowerCase();
  let idPattern: RegExp | null = null;
  if (sectionId) {
    idPattern = new RegExp(`\\b${escapeRegExp(sectionId)}\\b`, 'i');
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!line.startsWith('#')) continue;
    const lower = line.toLowerCase();
    if (lower.includes(titleLower)) return i;
    if (idPattern && idPattern.test(line)) return i;
  }
  return -1;
}

function collectSectionLinks(input: ComposeInput): Map<string, string[]> {
  const { evidenceSet, sectionDrafts } = input;
  const map = new Map<string, string[]>();
  const add = (sectionId: string, chunkIds: string[]) => {
    const existing = map.get(sectionId) ?? [];
    for (const id of chunkIds) {
      if (!existing.includes(id)) existing.push(id);
    }
    map.set(sectionId, existing);
  };
  for (const link of evidenceSet?.links ?? []) {
    add(link.sectionId, link.chunkIds);
  }
  for (const draft of sectionDrafts ?? []) {
    for (const link of draft.citations ?? []) {
      add(link.sectionId ?? draft.sectionId, link.chunkIds);
    }
  }
  return map;
}

function embedCitations(markdown: string, input: ComposeInput): string {
  const sections = input.master.analysis?.requiredSections ?? [];
  const sectionLinks = collectSectionLinks(input);
  if (sectionLinks.size === 0) return markdown;
  const lines = markdown.split('\n');
  const entries = Array.from(sectionLinks.entries());
  // Process in reverse so inserting citation lines does not shift later indices.
  for (let k = entries.length - 1; k >= 0; k -= 1) {
    const [sectionId, chunkIds] = entries[k]!;
    const title = sectionTitleById(sections, sectionId) ?? sectionId;
    const idx = findHeadingIndex(lines, title, sectionId);
    if (idx >= 0) {
      const markers = chunkIds.map((id) => `[${id}]`).join(' ');
      const citationLine = `> Evidence: ${markers}`;
      const afterHeading = lines[idx + 1];
      if (afterHeading !== citationLine) {
        lines.splice(idx + 1, 0, citationLine);
      }
    }
  }
  return lines.join('\n');
}

function buildReferences(chunks: EvidenceChunk[] = []): string {
  if (chunks.length === 0) return '';
  const refs = chunks.map((c) => {
    const snippet = c.content.slice(0, 200).replace(/\s+/g, ' ').trim();
    return `- [${c.id}] ${c.sourceName} (${c.sourceId}): ${snippet}`;
  });
  return `\n\n## References\n\n${refs.join('\n')}`;
}

function validateRequiredSections(markdown: string, sections: SectionOutline[] = []): string[] {
  const warnings: string[] = [];
  for (const s of flattenSections(sections)) {
    if (s.required === false) continue;
    if (!headingRegexFor(s.title).test(markdown)) {
      warnings.push(`Missing required section: ${s.title}`);
    }
  }
  return warnings;
}

function validateConstraints(markdown: string, constraints: Constraint[] = []): string[] {
  const warnings: string[] = [];
  for (const c of constraints) {
    if (c.kind === 'section_required') {
      const target = (c.ref || c.description).toLowerCase();
      if (!markdown.toLowerCase().includes(target)) {
        warnings.push(`Missing required section from constraint: ${c.ref || c.description}`);
      }
    } else if (c.kind === 'citation') {
      if (!/\[[^\]\n]+\]/.test(markdown)) {
        warnings.push(`Citation constraint not met: ${c.description}`);
      }
    } else {
      warnings.push(`Constraint not verified: [${c.kind}] ${c.description}`);
    }
  }
  return warnings;
}

function postProcess(markdown: string, input: ComposeInput): { markdown: string; warnings: string[] } {
  const chunks = input.evidenceSet?.chunks ?? [];
  const sections = input.master.analysis?.requiredSections ?? [];
  const constraints = input.master.analysis?.constraints ?? [];
  let md = embedCitations(markdown, input);
  if (chunks.length > 0) {
    md += buildReferences(chunks);
  }
  const warnings = [
    ...validateRequiredSections(md, sections),
    ...validateConstraints(md, constraints),
  ];
  return { markdown: md, warnings };
}

function fallbackMarkdown(input: ComposeInput): string {
  const { master, bindingSet } = input;
  const facts = (input as { facts?: unknown[] }).facts ?? [];
  const values = bindingSet?.values ?? {};
  const sections = master.analysis?.requiredSections ?? [];
  const lines = [`# ${master.name || 'Document'}`, ''];
  for (const section of sections) {
    lines.push(`${'#'.repeat(Math.min(Math.max(1, section.level), 6))} ${section.title}`);
    const relevant = facts.filter((f: unknown) => {
      const fact = f as { text?: string };
      return fact.text && section.title && fact.text.toLowerCase().includes(section.title.toLowerCase());
    });
    if (relevant.length > 0) {
      for (const f of relevant) {
        const fact = f as { text?: string; source?: string };
        lines.push(`- ${fact.text} ${fact.source ? `(source: ${fact.source})` : ''}`);
      }
    } else {
      for (const v of master.analysis?.variables ?? []) {
        if (section.title && (v.label.includes(section.title) || section.title.includes(v.label))) {
          lines.push(`- ${v.label}: ${values[v.key] ?? ''}`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function composeAuthor(input: ComposeInput): Promise<ComposeOutput> {
  const facts = (input as { facts?: unknown[] }).facts ?? [];
  const chunks = input.evidenceSet?.chunks ?? [];
  const sections = input.master.analysis?.requiredSections ?? [];
  const constraints = input.master.analysis?.constraints ?? [];

  const model = tryCreateModel();
  if (!model) {
    const warnings: string[] = facts.length === 0 && chunks.length === 0 ? ['No facts/evidence provided; sections are blank.'] : [];
    warnings.push('LLM model unavailable; using template fallback.');
    const { markdown, warnings: validationWarnings } = postProcess(fallbackMarkdown(input), input);
    return { bytes: new TextEncoder().encode(markdown), format: 'md', warnings: [...warnings, ...validationWarnings] };
  }

  const sectionList = sections
    .map((s) => `- ${'#'.repeat(Math.min(Math.max(1, s.level), 6))} ${s.title} (id: ${s.id})`)
    .join('\n') || 'None specified';
  const constraintList = constraints
    .map((c) => `- [${c.kind}] ${c.description}${c.ref ? ` (ref: ${c.ref})` : ''}`)
    .join('\n') || 'None specified';
  const evidenceList = chunks
    .map((c) => `- [${c.id}] ${c.sourceName} (${c.sourceId}): ${c.content.slice(0, 2000)}`)
    .join('\n') || 'None provided';
  const draftList = (input.sectionDrafts ?? [])
    .map((d) => `- Section "${d.title}" (${d.sectionId}): ${d.content.slice(0, 2000)}`)
    .join('\n') || 'None provided';
  const factList = facts
    .map((f) => `- ${typeof f === 'string' ? f : JSON.stringify(f).slice(0, 1000)}`)
    .join('\n') || 'None provided';
  const valueBlock = `\n\nBound values:\n${JSON.stringify(input.bindingSet?.values ?? {}, null, 2).slice(0, 8000)}`;

  const prompt = `Draft a complete markdown document using only the provided inputs.\n\nDocument name: ${input.master.name || 'Document'}\n\nRequired sections:\n${sectionList}\n\nConstraints / rules:\n${constraintList}\n\nEvidence chunks (use as sources and cite inline when used):\n${evidenceList}\n\nPre-drafted section content (preserve and integrate where appropriate):\n${draftList}\n\nKnown facts:\n${factList}${valueBlock}\n\nInstructions:\n- Cover every required section in order.\n- Do not invent facts; only use evidence, facts, drafts, and bound values provided.\n- When using an evidence chunk, include a citation like [chunk-id] or [sourceName].\n- If no information exists for a section, leave it blank or note "No information provided."\n- Return ONLY valid markdown; do not wrap the output in code fences.`;

  const { text } = await generateText({ model, prompt, maxOutputTokens: 8192, temperature: 0.2 });
  const baseWarnings: string[] = facts.length === 0 && chunks.length === 0 ? ['No facts or evidence provided; drafted content may be empty.'] : [];
  const { markdown, warnings } = postProcess(text, input);
  return { bytes: new TextEncoder().encode(markdown), format: 'md', warnings: [...baseWarnings, ...warnings] };
}
