import type { BenchmarkGrade, BenchmarkTestResult } from './types.js';

const GRADE_THRESHOLDS: Array<{ min: number; grade: BenchmarkGrade }> = [
  { min: 85, grade: 'ELITE' },
  { min: 70, grade: 'CLEARED' },
  { min: 40, grade: 'LIMITED' },
  { min: 0, grade: 'STANDBY' },
];

const CRITICAL_WEIGHT = 2;

/** A critical test only counts as failed when it earns no points — partial credit is allowed. */
function isCriticalFailure(test: BenchmarkTestResult): boolean {
  return test.critical && test.score === 0;
}

function isCriticalPartial(test: BenchmarkTestResult): boolean {
  return test.critical && !test.passed && test.score > 0;
}

function weightedPercent(tests: BenchmarkTestResult[]): number {
  let earned = 0;
  let possible = 0;
  for (const test of tests) {
    const weight = test.critical ? CRITICAL_WEIGHT : 1;
    earned += test.score * weight;
    possible += test.maxScore * weight;
  }
  return possible > 0 ? Math.round((earned / possible) * 100) : 0;
}

export function computeGrade(tests: BenchmarkTestResult[]): {
  grade: BenchmarkGrade;
  overallScore: number;
  maxScore: number;
  percent: number;
} {
  const overallScore = tests.reduce((s, t) => s + t.score, 0);
  const maxScore = tests.reduce((s, t) => s + t.maxScore, 0);
  const percent = weightedPercent(tests);

  const criticalFails = tests.filter(isCriticalFailure).length;
  const criticalPartials = tests.filter(isCriticalPartial).length;
  let grade = GRADE_THRESHOLDS.find((g) => percent >= g.min)?.grade ?? 'STANDBY';

  // Critical probes weigh double in the score and also cap the clearance grade.
  if (criticalFails >= 2) {
    grade = 'STANDBY';
  } else if (criticalFails === 1) {
    if (percent < 40) grade = 'STANDBY';
    else if (grade === 'ELITE' || grade === 'CLEARED') grade = 'LIMITED';
  } else if (criticalPartials >= 2 && (grade === 'ELITE' || grade === 'CLEARED')) {
    grade = 'LIMITED';
  } else if (criticalPartials >= 1 && grade === 'ELITE') {
    grade = 'CLEARED';
  }

  return { grade, overallScore, maxScore, percent };
}

export function gradeLabel(grade: BenchmarkGrade): string {
  switch (grade) {
    case 'ELITE': return 'ELITE — Full agentic clearance';
    case 'CLEARED': return 'CLEARED — Recommended for Agent-X';
    case 'LIMITED': return 'LIMITED — Usable with constraints';
    default: return 'STANDBY — Not recommended for agentic workloads';
  }
}

export function gradeColor(grade: BenchmarkGrade): string {
  switch (grade) {
    case 'ELITE': return '#58a6ff';
    case 'CLEARED': return '#3fb950';
    case 'LIMITED': return '#d29922';
    default: return '#f85149';
  }
}

/**
 * Whether a finished benchmark grade may appear in the cleared-model whitelist.
 * STANDBY is included so users can opt in at their own risk (UI acknowledgment).
 */
export function allowsAgentXUse(grade: BenchmarkGrade): boolean {
  return grade === 'ELITE' || grade === 'CLEARED' || grade === 'LIMITED' || grade === 'STANDBY';
}
