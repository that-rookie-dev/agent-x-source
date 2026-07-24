/**
 * Document Studio — merge_pack compose adapter (Phase 6, spec §6.2).
 *
 * Honest merge: produces a cover page + ordered concatenation of each
 * included master. Binary merge for docx/pdf is not implemented; output is MD.
 */

import type { ComposeInput, ComposeOutput } from '../runner/PrimitiveRegistry.js';

export async function composeMergePack(input: ComposeInput): Promise<ComposeOutput> {
  const { master, secondary } = input;
  const parts = [master, ...(secondary ?? [])];
  const lines: string[] = [`# ${master.name || 'Document Pack'}`, ''];
  lines.push('## Table of Contents');
  for (const m of parts) {
    lines.push(`- ${m.name} (${m.kind})`);
  }
  lines.push('');
  for (const m of parts) {
    lines.push(`---`);
    lines.push(`# ${m.name}`);
    const vars = m.analysis?.variables ?? [];
    for (const v of vars) lines.push(`- ${v.label}: ${v.sampleValue ?? '(sample)'}`);
    const sections = m.analysis?.requiredSections ?? [];
    for (const s of sections) lines.push(`## ${s.title}`);
    lines.push('');
  }
  return { bytes: new TextEncoder().encode(lines.join('\n')), format: 'md', warnings: ['merge_pack is markdown-only; no binary DOCX/PDF merge.'] };
}
