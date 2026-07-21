import { cpus, freemem, platform, arch, totalmem, hostname } from 'node:os';

/** User-facing resource profile. Maps to a CPU budget % under the hood. */
export type PerformancePreset = 'quiet' | 'balanced' | 'performance' | 'max';

export const PERFORMANCE_PRESETS: PerformancePreset[] = ['quiet', 'balanced', 'performance', 'max'];

export const PERFORMANCE_PRESET_BUDGET: Record<PerformancePreset, number> = {
  quiet: 25,
  balanced: 40,
  performance: 70,
  max: 80,
};

/**
 * Host share claimed by each preset. Tuned so common core counts (4/8/10/12)
 * do not round Quiet/Balanced/Performance/Max onto the same effectiveCores.
 */
const PRESET_HOST_SHARE: Record<PerformancePreset, number> = {
  quiet: 0.22,
  balanced: 0.40,
  performance: 0.62,
  max: 0.85,
};

/**
 * Additive lane bias on top of effectiveCores.
 * Keeps adjacent presets visibly different even when core math still collides
 * (tiny hosts, hard clamps).
 */
const PRESET_LANE_BIAS: Record<PerformancePreset, {
  llm: number;
  tools: number;
  subs: number;
  bg: number;
  attach: number;
  onnx: number;
}> = {
  quiet: { llm: 0, tools: 0, subs: 0, bg: 0, attach: 0, onnx: 0 },
  balanced: { llm: 0, tools: 1, subs: 1, bg: 0, attach: 0, onnx: 0 },
  performance: { llm: 1, tools: 2, subs: 2, bg: 1, attach: 0, onnx: 1 },
  max: { llm: 2, tools: 4, subs: 4, bg: 2, attach: 1, onnx: 1 },
};

const PRESET_TIER: Record<PerformancePreset, number> = {
  quiet: 0,
  balanced: 1,
  performance: 2,
  max: 3,
};

export interface PerformanceSettings {
  /**
   * Preferred profile. When set, drives budgetPercent.
   * Older configs may only have budgetPercent — we infer the nearest preset.
   */
  preset?: PerformancePreset;
  /**
   * Target CPU budget as a percent of available cores (10–80, default 40).
   * Kept for back-compat; derived from preset when preset is set.
   */
  budgetPercent?: number;
  /** @deprecated Use budgetPercent */
  cpuBudgetPercent?: number;
  /** Lazy-load session messages on demand instead of full DB hydrate at startup. Default true. */
  lazyStorageCache?: boolean;
  /** Max parallel CPU-bound background tasks. Derived from budget when unset. */
  backgroundConcurrency?: number;
}

/** Soft concurrency lanes derived for this host + budget. */
export interface PerformanceLanes {
  effectiveCores: number;
  llmGlobal: number;
  llmPerProvider: number;
  toolParallel: number;
  subAgents: number;
  backgroundConcurrency: number;
  onnxIntraOpThreads: number;
  onnxInterOpThreads: number;
  attachmentWorkers: number;
}

export interface ResolvedPerformanceSettings extends PerformanceLanes {
  preset: PerformancePreset;
  budgetPercent: number;
  lazyStorageCache: boolean;
}

export interface PerformanceHostProfile {
  hostname: string;
  platform: string;
  arch: string;
  cpuCores: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  /** Rough fitness 0–100 for running Agent-X concurrency (cores + RAM). */
  fitnessScore: number;
  localModelReady: boolean;
  cortexTier: 'bge-m3' | 'minilm';
}

export interface PerformancePresetProjection {
  preset: PerformancePreset;
  budgetPercent: number;
  lanes: PerformanceLanes;
  /** Short label for UI. */
  label: string;
  /** One-line outcome for this host. */
  summary: string;
  recommended: boolean;
}

export interface PerformanceShowcase {
  host: PerformanceHostProfile;
  activePreset: PerformancePreset;
  active: ResolvedPerformanceSettings;
  presets: PerformancePresetProjection[];
}

const DEFAULT_PRESET: PerformancePreset = 'balanced';

const PRESET_META: Record<PerformancePreset, { label: string; blurb: string }> = {
  quiet: { label: 'Quiet', blurb: 'Cool & light — minimal parallel work' },
  balanced: { label: 'Balanced', blurb: 'Default headroom for daily agent work' },
  performance: { label: 'Performance', blurb: 'Wide lanes for crew & research storms' },
  max: { label: 'Max', blurb: 'Highest allowed concurrency (80% ceiling)' },
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function inferPerformancePreset(budgetPercent?: number | null): PerformancePreset {
  const pct = budgetPercent ?? PERFORMANCE_PRESET_BUDGET.balanced;
  if (pct <= 30) return 'quiet';
  if (pct <= 50) return 'balanced';
  if (pct <= 75) return 'performance';
  return 'max';
}

function budgetFromSettings(settings?: PerformanceSettings | null): number | undefined {
  if (!settings) return undefined;
  if (typeof settings.budgetPercent === 'number') return settings.budgetPercent;
  const legacy = (settings as { cpuBudgetPercent?: number }).cpuBudgetPercent;
  return typeof legacy === 'number' ? legacy : undefined;
}

export function resolvePerformancePreset(settings?: PerformanceSettings | null): PerformancePreset {
  if (settings?.preset && PERFORMANCE_PRESETS.includes(settings.preset)) {
    return settings.preset;
  }
  return inferPerformancePreset(budgetFromSettings(settings));
}

function lanesFromEffectiveCores(
  effectiveCores: number,
  bias: (typeof PRESET_LANE_BIAS)[PerformancePreset],
): PerformanceLanes {
  const ec = Math.max(1, effectiveCores);
  const llmBase = ec + bias.llm;
  const onnxIntra = clamp(Math.ceil(ec / 2) + bias.onnx, 1, 4);
  return {
    effectiveCores: ec,
    llmGlobal: clamp(llmBase, 1, 8),
    llmPerProvider: clamp(Math.ceil(llmBase / 2), 1, 4),
    toolParallel: clamp(ec + bias.tools, 1, 12),
    subAgents: clamp(ec + bias.subs, 1, 16),
    backgroundConcurrency: clamp(Math.ceil(ec / 2) + bias.bg, 1, 6),
    onnxIntraOpThreads: onnxIntra,
    onnxInterOpThreads: clamp(Math.ceil(onnxIntra / 2), 1, 2),
    attachmentWorkers: clamp(Math.ceil(ec / 4) + bias.attach, 1, 3),
  };
}

/** Dominance score for ensuring Quiet < Balanced < Performance < Max in the UI. */
export function laneDominanceScore(lanes: PerformanceLanes): number {
  return (
    lanes.subAgents * 1_000_000
    + lanes.toolParallel * 10_000
    + lanes.llmGlobal * 100
    + lanes.backgroundConcurrency * 10
    + lanes.attachmentWorkers
    + lanes.effectiveCores * 1_000
  );
}

/**
 * Project soft lanes for a named preset on this host.
 * Guarantees a stepped profile: each higher preset claims more host share and
 * applies a larger lane bias so Performance ≠ Max on common machines (e.g. 8 cores).
 */
export function projectPresetLanes(cpuCount: number, preset: PerformancePreset): PerformanceLanes {
  const cores = Math.max(1, cpuCount);
  const tier = PRESET_TIER[preset];
  let effectiveCores = Math.max(1, Math.round(PRESET_HOST_SHARE[preset] * cores));
  // Tier floor so higher presets never collapse below lower ones when cores allow.
  effectiveCores = Math.max(effectiveCores, Math.min(cores, tier + 1));
  // Leave ~15% for the OS / UI.
  effectiveCores = Math.min(effectiveCores, Math.max(1, Math.round(cores * 0.85)));
  return lanesFromEffectiveCores(effectiveCores, PRESET_LANE_BIAS[preset]);
}

/**
 * Soft-lane mapping from hardware cores + budget %.
 * When `preset` is omitted, the nearest preset is inferred from budgetPercent.
 */
export function projectPerformanceLanes(
  cpuCount: number,
  budgetPercent: number,
  preset?: PerformancePreset | null,
): PerformanceLanes {
  const resolved = preset && PERFORMANCE_PRESETS.includes(preset)
    ? preset
    : inferPerformancePreset(budgetPercent);
  return projectPresetLanes(cpuCount, resolved);
}

/**
 * Build all four preset projections with a hard guarantee that each step is
 * strictly wider than the previous on the metrics shown in Settings.
 */
export function projectDistinctPresetLanes(
  cpuCount: number,
): Record<PerformancePreset, PerformanceLanes> {
  const out = {} as Record<PerformancePreset, PerformanceLanes>;
  let prevScore = -1;
  for (const preset of PERFORMANCE_PRESETS) {
    let lanes = projectPresetLanes(cpuCount, preset);
    let guard = 0;
    while (laneDominanceScore(lanes) <= prevScore && guard < 12) {
      lanes = {
        ...lanes,
        effectiveCores: lanes.effectiveCores + 1,
        subAgents: clamp(lanes.subAgents + 1, 1, 16),
        toolParallel: clamp(lanes.toolParallel + 1, 1, 12),
        llmGlobal: clamp(lanes.llmGlobal + (guard % 2 === 0 ? 1 : 0), 1, 8),
        backgroundConcurrency: clamp(lanes.backgroundConcurrency + (guard % 3 === 0 ? 1 : 0), 1, 6),
        attachmentWorkers: clamp(lanes.attachmentWorkers + (guard % 4 === 0 ? 1 : 0), 1, 3),
        onnxIntraOpThreads: clamp(lanes.onnxIntraOpThreads + (guard % 5 === 0 ? 1 : 0), 1, 4),
        onnxInterOpThreads: lanes.onnxInterOpThreads,
      };
      guard += 1;
    }
    out[preset] = lanes;
    prevScore = laneDominanceScore(lanes);
  }
  return out;
}

export function resolvePerformanceSettings(
  settings?: PerformanceSettings | null,
  cpuCount = cpus().length,
): ResolvedPerformanceSettings {
  const preset = resolvePerformancePreset(settings);
  const fromSettings = budgetFromSettings(settings);
  const budgetPercent = settings?.preset
    ? PERFORMANCE_PRESET_BUDGET[preset]
    : clamp(fromSettings ?? PERFORMANCE_PRESET_BUDGET[preset], 10, 80);
  const budget = settings?.preset ? PERFORMANCE_PRESET_BUDGET[preset] : budgetPercent;
  // Prefer the distinct stepped projection so live governor matches the showcase cards.
  const distinct = projectDistinctPresetLanes(cpuCount);
  const lanes = { ...distinct[preset] };

  if (settings?.backgroundConcurrency) {
    lanes.backgroundConcurrency = clamp(settings.backgroundConcurrency, 1, 8);
  }

  return {
    preset,
    budgetPercent: budget,
    lazyStorageCache: settings?.lazyStorageCache !== false,
    ...lanes,
  };
}

function fitnessScore(cpuCores: number, totalMemoryGB: number): number {
  // Heuristic showcase score — not a synthetic benchmark.
  const coreScore = clamp((cpuCores / 18) * 55, 8, 55);
  const ramScore = clamp((totalMemoryGB / 64) * 45, 5, 45);
  return Math.round(clamp(coreScore + ramScore, 10, 100));
}

export function buildPerformanceHostProfile(
  cpuCount = cpus().length,
  totalBytes = totalmem(),
  freeBytes = freemem(),
): PerformanceHostProfile {
  const totalMemoryGB = Math.round((totalBytes / 1024 ** 3) * 10) / 10;
  const freeMemoryGB = Math.round((freeBytes / 1024 ** 3) * 10) / 10;
  const cortexTier: 'bge-m3' | 'minilm' = totalMemoryGB >= 16 ? 'bge-m3' : 'minilm';
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    cpuCores: Math.max(1, cpuCount),
    totalMemoryGB,
    freeMemoryGB,
    fitnessScore: fitnessScore(cpuCount, totalMemoryGB),
    localModelReady: totalMemoryGB >= 32,
    cortexTier,
  };
}

function recommendPreset(host: PerformanceHostProfile): PerformancePreset {
  if (host.totalMemoryGB < 12 || host.cpuCores <= 4) return 'quiet';
  if (host.totalMemoryGB < 24 || host.cpuCores <= 8) return 'balanced';
  if (host.totalMemoryGB < 48) return 'performance';
  return 'max';
}

function presetSummary(host: PerformanceHostProfile, lanes: PerformanceLanes, preset: PerformancePreset): string {
  const crew = lanes.subAgents;
  const tools = lanes.toolParallel;
  if (preset === 'quiet') {
    return `Up to ${crew} crew workers · ${tools} tools · keeps ${host.platform} cool`;
  }
  if (preset === 'balanced') {
    return `${crew} parallel agents · ${tools} tools · solid daily throughput`;
  }
  if (preset === 'performance') {
    return `${crew} crew slots · ${tools} tools · built for research storms`;
  }
  return `${crew} crew · ${tools} tools · ${lanes.llmGlobal} LLM · ceiling profile`;
}

export function buildPerformanceShowcase(
  settings?: PerformanceSettings | null,
  cpuCount = cpus().length,
  totalBytes = totalmem(),
  freeBytes = freemem(),
): PerformanceShowcase {
  const host = buildPerformanceHostProfile(cpuCount, totalBytes, freeBytes);
  const active = resolvePerformanceSettings(settings, cpuCount);
  const recommended = recommendPreset(host);
  const distinct = projectDistinctPresetLanes(host.cpuCores);

  const presets: PerformancePresetProjection[] = PERFORMANCE_PRESETS.map((preset) => {
    const budgetPercent = PERFORMANCE_PRESET_BUDGET[preset];
    const lanes = distinct[preset];
    return {
      preset,
      budgetPercent,
      lanes,
      label: PRESET_META[preset].label,
      summary: presetSummary(host, lanes, preset),
      recommended: preset === recommended,
    };
  });

  return {
    host,
    activePreset: active.preset,
    active,
    presets,
  };
}

/** @deprecated alias — prefer buildPerformanceShowcase */
export function defaultPerformancePreset(): PerformancePreset {
  return DEFAULT_PRESET;
}
