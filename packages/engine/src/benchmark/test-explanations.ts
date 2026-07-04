export function explainPass(summary: string): string {
  return summary;
}

export function explainFailure(args: {
  task: string;
  expected: string;
  actual: string;
}): string {
  return `We asked the model to ${args.task}. Expected: ${args.expected}. Instead, the model ${args.actual}.`;
}

export function explainPartial(args: {
  score: number;
  maxScore: number;
  task: string;
  expected: string;
  actual: string;
  gap: string;
}): string {
  const pct = args.maxScore > 0 ? Math.round((args.score / args.maxScore) * 100) : 0;
  return `Partial credit (${args.score}/${args.maxScore}, ${pct}%). We asked the model to ${args.task}. Expected: ${args.expected}. The model ${args.actual}. ${args.gap}`;
}

export function formatTestDetails(
  score: number,
  maxScore: number,
  passed: boolean,
  passMsg: string,
  fail: { task: string; expected: string; actual: string },
  partial?: { actual: string; gap: string },
): string {
  if (passed) return explainPass(passMsg);
  if (score > 0 && partial) {
    return explainPartial({
      score,
      maxScore,
      task: fail.task,
      expected: fail.expected,
      actual: partial.actual,
      gap: partial.gap,
    });
  }
  return explainFailure(fail);
}
