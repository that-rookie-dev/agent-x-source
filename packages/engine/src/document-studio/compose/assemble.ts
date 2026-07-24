/**
 * Document Studio — assemble compose adapter (Phase 6, spec §6.2).
 *
 * Builds a document from a structure/standard master and bound values.
 * Honest: sections without content are emitted as placeholders, not fabricated.
 */

import type { ComposeInput, ComposeOutput } from '../runner/PrimitiveRegistry.js';

export async function composeAssemble(input: ComposeInput): Promise<ComposeOutput> {
  const { master, bindingSet, sectionDrafts } = input;
  const values = bindingSet?.values ?? {};
  const drafts = sectionDrafts && sectionDrafts.length > 0 ? sectionDrafts : (master.analysis?.requiredSections ?? []).map((s: { title: string }) => ({ sectionId: s.title, title: s.title, content: '', citations: [], status: 'drafted' as const }));
  const lines: string[] = [`# ${master.name || 'Assembled Document'}`, ''];
  const warnings: string[] = [];
  for (const section of drafts) {
    lines.push(`# ${section.title}`);
    if (section.content) {
      lines.push(section.content);
    } else {
      const matching = Object.entries(values).filter(([k]) => section.title.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(section.title.toLowerCase()));
      if (matching.length > 0) {
        for (const [k, v] of matching) lines.push(`- ${k}: ${String(v)}`);
      } else {
        lines.push(`(content pending)`);
        warnings.push(`Section "${section.title}" has no content.`);
      }
    }
    lines.push('');
  }
  return { bytes: new TextEncoder().encode(lines.join('\n')), format: 'md', warnings };
}
