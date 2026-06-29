// Capability detection: decides which renderers the footer switcher offers.
// force3d is always available; Cosmograph requires WebGPU + a real GPU.
// Results are cached for the session and can be force-overridden via
// localStorage flags (used by the switcher's override toggles).

export interface CapabilityReport {
  webgpu: boolean;
  hardwareConcurrency: number;
  cosmograph: boolean;
  cosmographReason: string;
}

const LS_COSMOGRAPH_FORCE = 'agx:cosmograph:force';

function detectWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

let cached: CapabilityReport | null = null;

export function getCapabilities(): CapabilityReport {
  if (cached) return cached;

  const webgpu = detectWebGPU();
  const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 0 : 0;
  const forceCosmograph =
    typeof localStorage !== 'undefined' && localStorage.getItem(LS_COSMOGRAPH_FORCE) === '1';

  let cosmograph = false;
  let cosmographReason = '';
  if (forceCosmograph) {
    cosmograph = true;
    cosmographReason = 'force-enabled (override)';
  } else if (!webgpu) {
    cosmograph = false;
    cosmographReason = 'WebGPU unavailable in this browser';
  } else if (hardwareConcurrency < 8) {
    cosmograph = false;
    cosmographReason = `needs >=8 cores (detected ${hardwareConcurrency})`;
  } else {
    cosmograph = true;
    cosmographReason = 'WebGPU + GPU detected';
  }

  cached = {
    webgpu,
    hardwareConcurrency,
    cosmograph,
    cosmographReason,
  };
  return cached;
}

export function setCosmographForceOverride(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (enabled) localStorage.setItem(LS_COSMOGRAPH_FORCE, '1');
  else localStorage.removeItem(LS_COSMOGRAPH_FORCE);
  cached = null; // re-evaluate on next read
}

/** Re-run detection (e.g. after the user toggles an override). */
export function refreshCapabilities(): CapabilityReport {
  cached = null;
  return getCapabilities();
}
