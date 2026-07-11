const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bfetch\s*\(/, reason: 'fetch() is not allowed in canvases' },
  { re: /\bXMLHttpRequest\b/, reason: 'XMLHttpRequest is not allowed' },
  { re: /\bWebSocket\b/, reason: 'WebSocket is not allowed' },
  { re: /\beval\s*\(/, reason: 'eval() is not allowed' },
  { re: /\bFunction\s*\(/, reason: 'Function constructor is not allowed' },
  { re: /\bimport\s*\(/, reason: 'dynamic import() is not allowed' },
  { re: /\brequire\s*\(/, reason: 'require() is not allowed' },
  { re: /\bchild_process\b/, reason: 'Node child_process is not allowed' },
  { re: /\bnode:fs\b|\bfrom\s+['"]fs['"]/, reason: 'filesystem access is not allowed' },
  { re: /\bnode:path\b|\bfrom\s+['"]path['"]/, reason: 'path module is not allowed' },
];

const ALLOWED_IMPORTS = new Set(['react', '@agentx/canvas']);

const IMPORT_RE = /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export interface CanvasValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateCanvasSource(source: string): CanvasValidationResult {
  const errors: string[] = [];

  if (!source.trim()) {
    return { ok: false, errors: ['Canvas source is empty'] };
  }
  if (source.length > 512_000) {
    errors.push('Canvas source exceeds 512KB limit');
  }

  for (const { re, reason } of FORBIDDEN_PATTERNS) {
    if (re.test(source)) errors.push(reason);
  }

  for (const match of source.matchAll(IMPORT_RE)) {
    const mod = match[1]!;
    const base = mod.split('/')[0] === 'react' ? 'react' : mod;
    if (!ALLOWED_IMPORTS.has(base) && !mod.startsWith('react/')) {
      errors.push(`Disallowed import: "${mod}" — only react and @agentx/canvas are permitted`);
    }
  }
  for (const match of source.matchAll(REQUIRE_RE)) {
    errors.push(`Disallowed require: "${match[1]}"`);
  }

  if (!/export\s+default\s+/m.test(source)) {
    errors.push('Canvas must default-export a React component');
  }

  return { ok: errors.length === 0, errors };
}
