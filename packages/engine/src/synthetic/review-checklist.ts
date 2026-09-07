export interface CodeReviewFinding {
  id: string;
  ok: boolean;
  detail: string;
}

export function reviewGeneratedCode(code: string): CodeReviewFinding[] {
  return [
    {
      id: 'no-hardcoded-secrets',
      ok: !/(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]+['"]/i.test(code),
      detail: 'No hardcoded secrets',
    },
    {
      id: 'no-eval',
      ok: !/\beval\s*\(|new Function\s*\(/.test(code),
      detail: 'No eval or Function constructor',
    },
    {
      id: 'input-validation',
      ok: /args|input|params/.test(code),
      detail: 'Reads a single args/input object at the boundary',
    },
    {
      id: 'no-leaky-errors',
      ok: !/stack|process\.env/.test(code) || /catch/.test(code),
      detail: 'Error messages should not leak internals',
    },
    {
      id: 'bounded-loops',
      ok: !/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(code),
      detail: 'No infinite loops',
    },
    {
      id: 'resource-cleanup',
      ok: !/createReadStream|createWriteStream|openSync/.test(code) || /finally/.test(code),
      detail: 'Resource cleanup in finally blocks when opening handles',
    },
  ];
}
