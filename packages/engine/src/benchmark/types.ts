import type { ModelCapability } from '@agentx/shared';

export type BenchmarkGrade = 'STANDBY' | 'LIMITED' | 'CLEARED' | 'ELITE';

export type BenchmarkTestId =
  | 'reasoning'
  | 'coding'
  | 'debugging'
  | 'documentation'
  | 'clarification'
  | 'decision_making'
  | 'tool_calling'
  | 'json_structure'
  | 'instruction_following'
  | 'agent_identity';

export type ModalityProbeId = 'vision' | 'audio' | 'video' | 'image_generation';

export interface BenchmarkTestResult {
  id: BenchmarkTestId;
  label: string;
  category: 'core';
  score: number;
  maxScore: number;
  passed: boolean;
  latencyMs: number;
  critical: boolean;
  details?: string;
  error?: string;
}

export interface ModalityProbeResult {
  id: ModalityProbeId;
  label: string;
  detected: boolean;
  source: 'catalog' | 'inferred' | 'probe' | 'unknown';
  tested: boolean;
  probeStatus?: 'passed' | 'failed' | 'skipped' | 'unsupported';
  note?: string;
  details?: string;
}

export interface BenchmarkRunConfig {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  profileId?: string;
  modelCapabilities?: ModelCapability[];
}

export interface BenchmarkRunResult {
  runId: string;
  providerId: string;
  modelId: string;
  profileId?: string;
  grade: BenchmarkGrade;
  overallScore: number;
  maxScore: number;
  percent: number;
  tests: BenchmarkTestResult[];
  modalities: ModalityProbeResult[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Basename of the terminal archive log (without directory). */
  logFile?: string;
  /** True when loaded from a saved benchmark instead of a live run. */
  fromCache?: boolean;
}

export type BenchmarkProgressEvent =
  | { type: 'started'; runId: string; modelId: string; providerId: string; totalTests: number }
  | { type: 'phase'; phase: 'core' | 'modality' | 'grading'; message: string }
  | { type: 'test_start'; testId: BenchmarkTestId; label: string; index: number; total: number }
  | { type: 'test_complete'; result: BenchmarkTestResult; index: number; total: number }
  | { type: 'modality'; result: ModalityProbeResult }
  | { type: 'complete'; result: BenchmarkRunResult }
  | { type: 'error'; error: string };
