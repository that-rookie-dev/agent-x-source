/**
 * Central soft-concurrency governor for Settings → Performance profiles.
 * Retunes LLM / tools / sub-agents / background / ONNX / attachment lanes.
 *
 * Semantics: lane caps queue work until a slot frees — they never drop mission work.
 */
import type { ResolvedPerformanceSettings, PerformanceSettings } from '@agentx/shared';
import { resolvePerformanceSettings } from '@agentx/shared';
import { configureBackgroundTaskPool } from '../runtime/BackgroundTaskPool.js';
import { setOnnxThreadConfig } from '../runtime/onnx-thread-config.js';

export type PerformanceLanesPatch = {
  subAgents: number;
  toolParallel: number;
  llmGlobal: number;
};

export type PerformanceTuneTarget = {
  applyPerformanceLanes: (lanes: PerformanceLanesPatch) => void;
};

let current: ResolvedPerformanceSettings = resolvePerformanceSettings(null);
const tuneTargets = new Set<PerformanceTuneTarget>();

export function getPerformanceLanes(): Readonly<ResolvedPerformanceSettings> {
  return current;
}

export function getLlmConcurrencyLimits(): { global: number; perProvider: number } {
  return { global: current.llmGlobal, perProvider: current.llmPerProvider };
}

export function getAttachmentWorkerLimit(): number {
  return current.attachmentWorkers;
}

function lanesPatchFrom(resolved: ResolvedPerformanceSettings): PerformanceLanesPatch {
  return {
    subAgents: resolved.subAgents,
    toolParallel: resolved.toolParallel,
    llmGlobal: resolved.llmGlobal,
  };
}

export function registerPerformanceTuneTarget(target: PerformanceTuneTarget): () => void {
  tuneTargets.add(target);
  // Apply current lanes immediately so late-mounted agents match the profile.
  target.applyPerformanceLanes(lanesPatchFrom(current));
  return () => { tuneTargets.delete(target); };
}

export function applyPerformanceGovernor(
  settings?: PerformanceSettings | null,
  cpuCount?: number,
): ResolvedPerformanceSettings {
  const resolved = resolvePerformanceSettings(settings, cpuCount);
  current = resolved;
  configureBackgroundTaskPool(resolved.backgroundConcurrency);
  setOnnxThreadConfig(resolved.onnxIntraOpThreads, resolved.onnxInterOpThreads);
  const patch = lanesPatchFrom(resolved);
  for (const target of tuneTargets) {
    try {
      target.applyPerformanceLanes(patch);
    } catch {
      // Agent may be disposing — ignore
    }
  }
  return resolved;
}
