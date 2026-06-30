/**
 * Regression corpus for the neural brain node-extraction refactor.
 *
 * Each item is a real-world-shaped input (chat turn or markdown doc) paired with
 * a golden expectation: an acceptable node-count range and a set of forbidden
 * label patterns. Every phase of the refactor (Phase 1+) must keep every item
 * within its golden range and produce zero forbidden-label nodes.
 *
 * See NEURAL_BRAIN_NODE_EXTRACTION_PLAN.md §11 (Success Criteria) and §9 Phase 0.
 *
 * This module is importable from tests; it does not run anything on its own.
 * Use `runCorpusAgainstExtractor` (below) in a vitest test to exercise an
 * extractor implementation against the whole corpus.
 */

export interface CorpusItem {
  /** Stable id, used in test failure messages. */
  id: string;
  /** Human-readable description of what the item exercises. */
  description: string;
  /** The raw input text an extractor would receive. */
  text: string;
  /** Whether this is a chat turn or a document. Drives segmenter selection. */
  kind: 'chat_turn' | 'markdown_doc';
  /** Acceptable extracted-node count range (after validation). */
  expectedNodes: { min: number; max: number };
  /**
   * Label substrings that must NEVER appear on any extracted node for this item.
   * Always includes the global forbidden set; item-specific entries are appended.
   */
  forbiddenLabels?: string[];
}

/**
 * Global forbidden label patterns — no extracted node from any corpus item may
 * have a label matching any of these. This is the divider/fragment bug list.
 */
export const GLOBAL_FORBIDDEN_LABELS = [
  '---',
  '***',
  '___',
  '——',
  '--',
  '...',  // pure punctuation
  '##',   // bare markdown heading markers
  '###',
  '####',
];

export interface CorpusResult {
  itemId: string;
  passed: boolean;
  nodeCount: number;
  violations: string[];
}

/**
 * Run an extractor against every corpus item and return per-item results.
 *
 * The `extract` callback receives the raw text and must return the nodes it
 * would persist (post-validation). Tests pass this in from the extractor under
 * test (e.g. `MemoryExtractor`, `StructuredMemoryPipeline`).
 */
export async function runCorpusAgainstExtractor(
  extract: (text: string, kind: 'chat_turn' | 'markdown_doc') => Promise<Array<{ label: string; content: string }>>,
): Promise<CorpusResult[]> {
  const results: CorpusResult[] = [];
  for (const item of CORPUS) {
    const violations: string[] = [];
    let nodes: Array<{ label: string; content: string }> = [];
    try {
      nodes = await extract(item.text, item.kind);
    } catch (e) {
      violations.push(`extractor threw: ${e instanceof Error ? e.message : String(e)}`);
      results.push({ itemId: item.id, passed: false, nodeCount: 0, violations });
      continue;
    }

    const nodeCount = nodes.length;
    if (nodeCount < item.expectedNodes.min) {
      violations.push(`node count ${nodeCount} < min ${item.expectedNodes.min}`);
    }
    if (nodeCount > item.expectedNodes.max) {
      violations.push(`node count ${nodeCount} > max ${item.expectedNodes.max}`);
    }

    const forbidden = [...GLOBAL_FORBIDDEN_LABELS, ...(item.forbiddenLabels ?? [])];
    for (const node of nodes) {
      const label = node.label.trim();
      for (const bad of forbidden) {
        if (label === bad || label.startsWith(bad)) {
          violations.push(`forbidden label "${label}" (matches "${bad}")`);
        }
      }
      // No pure-punctuation labels.
      if (label.length > 0 && !/[a-zA-Z0-9]/.test(label)) {
        violations.push(`pure-punctuation label "${label}"`);
      }
    }

    results.push({
      itemId: item.id,
      passed: violations.length === 0,
      nodeCount,
      violations,
    });
  }
  return results;
}

/** Assert (vitest) that every corpus item passed; throw with a full report if not. */
export function assertCorpusPassed(results: CorpusResult[]): void {
  const failures = results.filter((r) => !r.passed);
  if (failures.length === 0) return;
  const report = failures
    .map((f) => `  [${f.itemId}] (${f.nodeCount} nodes)\n    - ${f.violations.join('\n    - ')}`)
    .join('\n');
  throw new Error(`Corpus regressions (${failures.length}/${results.length} items failed):\n${report}`);
}

export const CORPUS: readonly CorpusItem[] = [
  // ─── Chat turns ──────────────────────────────────────────────────────────
  {
    id: 'chat.simple-qa',
    description: 'Simple one-sentence question',
    text: 'user: How do I reset my password?',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 4 },
  },
  {
    id: 'chat.tool-call',
    description: 'Assistant turn describing a tool call result',
    text: 'assistant: I used the WebCrawler tool on https://example.com and extracted an article about climate policy.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 6 },
  },
  {
    id: 'chat.divider-laden',
    description: 'Chat turn containing markdown horizontal rules that must NOT become nodes',
    text: 'user: Here is my plan:\n---\n1. Build the API\n2. Test it\n---\nThen ship.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 6 },
    forbiddenLabels: ['1. Build the API', '2. Test it', 'Then ship.'],
  },
  {
    id: 'chat.multi-clause',
    description: 'A multi-clause sentence that should yield a few propositions, not many fragments',
    text: 'assistant: The auth service issues JWT tokens with a 1-hour expiry, refreshes them via the /refresh endpoint, and revokes them through a Redis-backed blacklist when the user logs out.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 8 },
  },
  {
    id: 'chat.code-block',
    description: 'Chat turn containing a fenced code block',
    text: 'assistant: Here is the function:\n```ts\nfunction add(a: number, b: number) { return a + b; }\n```\nIt returns the sum.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 6 },
  },
  {
    id: 'chat.empty',
    description: 'Empty / whitespace-only input must yield zero nodes (or one raw_fallback)',
    text: '   \n\n  ',
    kind: 'chat_turn',
    expectedNodes: { min: 0, max: 1 },
  },
  {
    id: 'chat.non-english',
    description: 'Non-English text still produces valid nodes',
    text: 'user: El servicio devuelve 404 cuando el usuario no existe.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 4 },
  },
  {
    id: 'chat.list-heavy',
    description: 'A bulleted list of features — list items become nodes, not the bullets',
    text: 'assistant: The new release includes:\n- Faster ingestion\n- Better dedup\n- Lower LLM cost\n- Offline mode',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 8 },
  },
  {
    id: 'chat.short-confirmation',
    description: 'A one-word-ish confirmation that should yield at most one node',
    text: 'assistant: Done.',
    kind: 'chat_turn',
    expectedNodes: { min: 0, max: 2 },
  },
  {
    id: 'chat.heading-only',
    description: 'A turn that is just a markdown heading must not become a heading-only node',
    text: 'user: ## Notes',
    kind: 'chat_turn',
    expectedNodes: { min: 0, max: 2 },
    forbiddenLabels: ['## Notes', 'Notes'],
  },
  {
    id: 'chat.two-sentences',
    description: 'Two related sentences — should yield 1-3 nodes, not 10 fragments',
    text: 'assistant: The API returns 404 when the user is not found. It returns 500 on internal errors.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 4 },
  },
  {
    id: 'chat.long-paragraph',
    description: 'A long single-paragraph turn — should yield a bounded number of nodes',
    text: 'assistant: ' + 'The system uses a token bucket rate limiter backed by Redis. '.repeat(8) + 'This ensures fair usage across tenants.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 12 },
  },
  {
    id: 'chat.url-only',
    description: 'A turn that is just a URL — should yield at most one node',
    text: 'user: https://example.com/article',
    kind: 'chat_turn',
    expectedNodes: { min: 0, max: 2 },
  },
  {
    id: 'chat.mixed-roles',
    description: 'A multi-role prefixed turn (user + assistant) — role prefixes must not become nodes',
    text: 'user: What is RAG?\nassistant: RAG stands for Retrieval-Augmented Generation. It grounds LLM outputs in retrieved documents.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 6 },
    forbiddenLabels: ['user:', 'assistant:'],
  },
  {
    id: 'chat.fragment-risk',
    description: 'A turn ending mid-clause — must not produce a fragment node',
    text: 'user: The system uses a token bucket and',
    kind: 'chat_turn',
    expectedNodes: { min: 0, max: 3 },
  },
  {
    id: 'chat.table',
    description: 'A turn containing a markdown table — table structure must not become nodes',
    text: 'user: | Method | Status |\n|---|---|\n| GET | 200 |\n| POST | 201 |',
    kind: 'chat_turn',
    expectedNodes: { min: 0, max: 6 },
    forbiddenLabels: ['|---|---|', 'GET', 'POST'],
  },
  {
    id: 'chat.numbered-list',
    description: 'A numbered list — items become nodes without the numbering',
    text: 'assistant: Steps to deploy:\n1. Build the image\n2. Push to registry\n3. Roll the deployment',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 6 },
  },
  {
    id: 'chat.em-dash-divider',
    description: 'Em-dash divider lines must not become nodes',
    text: 'user: Intro text here.\n——\nClosing text here.',
    kind: 'chat_turn',
    expectedNodes: { min: 0, max: 4 },
  },
  {
    id: 'chat.bold-heading',
    description: 'A bold pseudo-heading — must not become a heading-only node',
    text: 'assistant: **Summary**\nThe release ships tomorrow.',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 4 },
  },
  {
    id: 'chat.nested-list',
    description: 'A nested list — nested structure must not leak into labels',
    text: 'assistant: Plan:\n- Frontend\n  - React\n  - Vite\n- Backend\n  - Postgres\n  - Redis',
    kind: 'chat_turn',
    expectedNodes: { min: 1, max: 10 },
  },

  // ─── Markdown docs ───────────────────────────────────────────────────────
  {
    id: 'doc.short-section',
    description: 'A single short markdown section',
    text: '# Auth\n\nThe auth service issues JWT tokens with a 1-hour expiry.',
    kind: 'markdown_doc',
    expectedNodes: { min: 1, max: 8 },
  },
  {
    id: 'doc.multi-heading',
    description: 'A multi-heading markdown doc — each section yields nodes',
    text: '# API\n\nThe API exposes REST endpoints.\n\n## Auth\n\nJWT tokens expire in 1 hour.\n\n## Rate Limiting\n\nA token bucket limits requests to 100 per minute.',
    kind: 'markdown_doc',
    expectedNodes: { min: 2, max: 20 },
  },
  {
    id: 'doc.code-fences',
    description: 'A markdown doc with code fences — code blocks must not become fragment nodes',
    text: '# Examples\n\n```ts\nconst x = 1;\n```\n\nThis shows how to declare a constant.',
    kind: 'markdown_doc',
    expectedNodes: { min: 1, max: 10 },
  },
  {
    id: 'doc.list-heavy',
    description: 'A list-heavy markdown doc — list items become nodes',
    text: '# Features\n\n- Fast ingestion\n- Better dedup\n- Lower LLM cost\n- Offline mode',
    kind: 'markdown_doc',
    expectedNodes: { min: 1, max: 12 },
  },
  {
    id: 'doc.table',
    description: 'A markdown doc with a table — table rows must not become fragment nodes',
    text: '# Endpoints\n\n| Method | Path | Status |\n|---|---|---|\n| GET | /users | 200 |\n| POST | /users | 201 |',
    kind: 'markdown_doc',
    expectedNodes: { min: 1, max: 12 },
    forbiddenLabels: ['|---|---|---|'],
  },
] as const;
