/**
 * Document Studio — render-style compose adapters (Phase 6, spec §6.2).
 *
 * Honest, deterministic outputs from the binding set / master variables.
 * These are not layout-cloned WYSIWYG; they are serialisations of the data.
 */

import type { ComposeInput, ComposeOutput } from '../runner/PrimitiveRegistry.js';

function toUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export async function composeMarkdown(input: ComposeInput): Promise<ComposeOutput> {
  const { master, bindingSet } = input;
  const values = bindingSet?.values ?? {};
  const vars = master.analysis?.variables ?? [];
  const lines = [`# ${master.name || 'Document'}`, ''];
  for (const v of vars) {
    lines.push(`## ${v.label}`);
    lines.push(String(values[v.key] ?? v.sampleValue ?? '(blank)'));
    lines.push('');
  }
  return { bytes: toUtf8(lines.join('\n')), format: 'md', warnings: [] };
}

export async function composeHtml(input: ComposeInput): Promise<ComposeOutput> {
  const { master, bindingSet } = input;
  const values = bindingSet?.values ?? {};
  const vars = master.analysis?.variables ?? [];
  const rows = vars.map((v) => `<tr><td>${v.label}</td><td>${String(values[v.key] ?? v.sampleValue ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td></tr>`).join('\n');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${master.name}</title></head><body><h1>${master.name}</h1><table border="1">${rows}</table></body></html>`;
  return { bytes: toUtf8(html), format: 'html', warnings: [] };
}

export async function composeJson(input: ComposeInput): Promise<ComposeOutput> {
  const values = input.bindingSet?.values ?? {};
  return { bytes: toUtf8(JSON.stringify(values, null, 2)), format: 'json', warnings: [] };
}

export async function composeYaml(input: ComposeInput): Promise<ComposeOutput> {
  const values = input.bindingSet?.values ?? {};
  const lines: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const safe = typeof v === 'string' && v.includes(':') ? `"${v.replace(/"/g, '\\"')}"` : String(v);
    lines.push(`${k}: ${safe}`);
  }
  return { bytes: toUtf8(lines.join('\n')), format: 'yaml', warnings: [] };
}

export async function composeDiagram(input: ComposeInput): Promise<ComposeOutput> {
  const values = input.bindingSet?.values ?? {};
  const entries = Object.entries(values);
  const body = entries.length === 0 ? '  N0["empty"]\n' : entries.map(([k, v], i) => `  N${i}["${k}"] --> V${i}["${String(v).slice(0, 30)}"]`).join('\n');
  const mermaid = `graph TD\n${body}`;
  return { bytes: toUtf8(mermaid), format: 'mmd', warnings: [] };
}

export async function composeLatex(input: ComposeInput): Promise<ComposeOutput> {
  const { master, bindingSet } = input;
  const values = bindingSet?.values ?? {};
  const vars = master.analysis?.variables ?? [];
  const rows = vars.map((v) => `\\item ${v.label}: ${String(values[v.key] ?? v.sampleValue ?? '')}`).join('\n');
  const latex = `\\documentclass{article}\n\\begin{document}\n\\section*{${master.name}}\n\\begin{itemize}\n${rows}\n\\end{itemize}\n\\end{document}`;
  return { bytes: toUtf8(latex), format: 'tex', warnings: [] };
}
