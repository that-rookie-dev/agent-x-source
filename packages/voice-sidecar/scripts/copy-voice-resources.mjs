/**
 * Copy voice-sidecar runtime resources for desktop/server packaging.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const voiceSidecarRoot = join(scriptDir, '..');

export function copyVoiceSidecarResources(destRoot, options = {}) {
  const { requireBundled = false } = options;
  const dest = join(destRoot, 'voice-sidecar');
  mkdirSync(dest, { recursive: true });

  for (const file of ['pyproject.toml', 'README.md', 'voice-models.manifest.json']) {
    const src = join(voiceSidecarRoot, file);
    if (existsSync(src)) {
      cpSync(src, join(dest, file));
    }
  }

  cpSync(join(voiceSidecarRoot, 'agentx_voice'), join(dest, 'agentx_voice'), {
    recursive: true,
    filter: (src) => !src.includes(`${join('agentx_voice', 'tests')}`) && !src.includes('__pycache__'),
  });

  const bundledSrc = join(voiceSidecarRoot, 'bundled');
  if (existsSync(bundledSrc)) {
    cpSync(bundledSrc, join(dest, 'bundled'), { recursive: true });
  } else if (requireBundled) {
    throw new Error(
      'Missing packages/voice-sidecar/bundled. Run: pnpm --filter @agentx/voice-sidecar run setup:bundled',
    );
  } else {
    console.warn('copy-voice-resources: bundled assets missing; voice deploy will download on first run');
  }

  return dest;
}
