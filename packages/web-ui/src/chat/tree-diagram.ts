/** Box-drawing tree lines (├── └── │) common in LLM architecture output. */
const TREE_CONNECTOR = /(?:├──|└──|│)/;

export function isTreeDiagramLine(line: string): boolean {
  return TREE_CONNECTOR.test(line);
}

export function isTreeDiagramContent(text: string): boolean {
  return TREE_CONNECTOR.test(text);
}

/** Split inline trees: `Root ├── A ├── B` → multiple lines. */
export function expandCollapsedTreeLine(line: string): string {
  if (!TREE_CONNECTOR.test(line)) return line;
  if (line.includes('\n')) return line;

  return line
    .replace(/\s+(?=(?:├──|└──))/g, '\n')
    .replace(/\s+(?=│\s*(?:├──|└──))/g, '\n')
    .replace(/\s+(?=│(?:\s+│|\s+├──|\s+└──))/g, '\n');
}

/** Separate a prose prefix from tree connectors on the same line. */
export function splitTitleFromTreeLine(line: string): { title?: string; treeLines: string[] } {
  const match = line.match(/^(.+?)(:\s*)((?:├──|└──|│).*)$/);
  if (!match) {
    return { treeLines: expandCollapsedTreeLine(line).split('\n').filter(Boolean) };
  }
  const title = `${match[1]!.trim()}${match[2] ?? ''}`.trimEnd();
  const tree = expandCollapsedTreeLine(match[3]!.trim());
  return { title, treeLines: tree.split('\n').filter(Boolean) };
}

/** Re-tag plain ``` fences that contain box-drawing trees as ```tree blocks. */
export function repairPlainTreeFences(content: string): string {
  if (!content || !content.includes('```') || !TREE_CONNECTOR.test(content)) return content;

  return content.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang: string, body: string) => {
    const language = (lang || '').toLowerCase();
    if (language === 'tree' || language === 'diagram') return match;
    if (!TREE_CONNECTOR.test(body)) return match;
    return `\`\`\`tree\n${body.trimEnd()}\n\`\`\``;
  });
}

/** Wrap tree blocks in ```tree fences so markdown renders them as monospace diagrams. */
export function repairTreeDiagrams(content: string): string {
  if (!content || !TREE_CONNECTOR.test(content)) return content;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let treeBuf: string[] = [];
  let inFence = false;

  const flushTree = () => {
    if (treeBuf.length === 0) return;
    const body: string[] = [];
    for (const raw of treeBuf) {
      const { title, treeLines } = splitTitleFromTreeLine(raw.trim());
      if (title) out.push(title);
      body.push(...treeLines);
    }
    if (body.length > 0) {
      out.push('```tree');
      out.push(body.join('\n'));
      out.push('```');
    }
    treeBuf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flushTree();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (isTreeDiagramLine(trimmed)) {
      treeBuf.push(line);
      continue;
    }

    // Continuation lines that only extend vertical bars
    if (treeBuf.length > 0 && /^\s*│/.test(line)) {
      treeBuf.push(line);
      continue;
    }

    flushTree();
    out.push(line);
  }

  flushTree();
  return out.join('\n');
}
