import { createHash } from 'node:crypto';
import type { BenchmarkGrade, BenchmarkRunResult, BenchmarkTestResult, ModalityProbeResult } from './types.js';

const WIDTH = 72;
const LOG_FORMAT_VERSION = '1.0';

function line(char = '─'): string {
  return char.repeat(WIDTH);
}

function pad(label: string, value: string): string {
  return `  ${label.padEnd(10)}: ${value}`;
}

function statusIcon(test: BenchmarkTestResult): string {
  if (test.passed) return 'PASS';
  if (test.score > 0) return 'PART';
  if (test.error) return ' ERR';
  return 'FAIL';
}

function modalityIcon(probe: ModalityProbeResult): string {
  if (!probe.tested) return 'SKIP';
  if (probe.probeStatus === 'passed') return 'PASS';
  if (probe.probeStatus === 'unsupported') return ' N/A';
  return 'FAIL';
}

function gradeBanner(grade: BenchmarkGrade): string {
  const labels: Record<BenchmarkGrade, string> = {
    ELITE: 'ELITE — Full agentic clearance',
    CLEARED: 'CLEARED — Recommended for Agent-X',
    LIMITED: 'LIMITED — Usable with constraints',
    STANDBY: 'STANDBY — Not recommended for agentic workloads',
  };
  return labels[grade];
}

export function formatBenchmarkLog(result: BenchmarkRunResult, options?: { cached?: boolean }): string {
  const lines: string[] = [];
  const watermark = [
    '╔' + '═'.repeat(WIDTH) + '╗',
    '║' + center('AGENT-X  ·  MODEL CLEARANCE BENCHMARK LOG', WIDTH) + '║',
    '║' + center('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', WIDTH) + '║',
    '╚' + '═'.repeat(WIDTH) + '╝',
  ];

  lines.push(...watermark, '');
  if (options?.cached) {
    lines.push('[ARCHIVE] Loaded from saved benchmark log — scan not re-run');
    lines.push('');
  }

  lines.push(`[${result.startedAt}] RUN STARTED`);
  lines.push(pad('provider', result.providerId));
  lines.push(pad('model', result.modelId));
  if (result.profileId) lines.push(pad('profile', result.profileId));
  lines.push(pad('run-id', result.runId));
  lines.push(pad('format', `Agent-X benchmark log v${LOG_FORMAT_VERSION}`));
  lines.push('');

  lines.push('── CORE CAPABILITY MATRIX ' + line().slice(24));
  for (const test of result.tests) {
    const pct = test.maxScore > 0 ? Math.round((test.score / test.maxScore) * 100) : 0;
    const icon = statusIcon(test);
    const critical = test.critical ? ' [CRITICAL]' : '';
    lines.push(
      `[${icon}] ${test.label.padEnd(28)} ${String(test.score).padStart(2)}/${test.maxScore}  ${String(pct).padStart(3)}%  ${test.latencyMs}ms${critical}`,
    );
    const detail = test.error || test.details;
    if (detail) {
      for (const wrap of wrapText(detail, WIDTH - 6)) {
        lines.push(`      ${wrap}`);
      }
    }
  }
  lines.push('');

  lines.push('── SENSORY CHANNELS ' + line().slice(20));
  for (const probe of result.modalities) {
    const icon = modalityIcon(probe);
    const state = probe.detected ? 'SUPPORTED' : 'NOT SUPPORTED';
    lines.push(`[${icon}] ${probe.label.padEnd(28)} ${state}`);
    if (probe.note) lines.push(`      ${probe.note}`);
    if (probe.details) {
      for (const wrap of wrapText(probe.details, WIDTH - 6)) {
        lines.push(`      ${wrap}`);
      }
    }
  }
  lines.push('');

  lines.push('── CLEARANCE VERDICT ' + line().slice(21));
  lines.push(pad('grade', gradeBanner(result.grade)));
  lines.push(pad('score', `${result.overallScore} / ${result.maxScore} (${result.percent}%)`));
  lines.push(pad('duration', `${(result.durationMs / 1000).toFixed(1)}s`));
  lines.push(pad('finished', result.finishedAt));
  lines.push('');
  lines.push('══ END OF BENCHMARK LOG ' + '═'.repeat(WIDTH - 25));
  lines.push('Agent-X Model Clearance System · terminal archive · safe to share');
  lines.push(`Log generated at ${new Date().toISOString()}`);
  return lines.join('\n');
}

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text + ' '.repeat(width - text.length - left);
}

function wrapText(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current + ' ' + word).length <= width) {
      current += ' ' + word;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out.length > 0 ? out : [''];
}

export function benchmarkArtifactBasename(providerId: string, modelId: string): string {
  const hash = createHash('sha256').update(`${providerId}::${modelId}`).digest('hex').slice(0, 16);
  return `${providerId}--${hash}`;
}
