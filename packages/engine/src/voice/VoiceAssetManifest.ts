import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoiceConfig, VoiceDownloadedAsset } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { computeDirectorySha256 } from './VoiceAssetManager.js';
import { isVoiceAssetInstalled } from './VoiceAssetCatalog.js';

export type VoiceAssetTier = 'bundled' | 'download' | 'optional';

export interface VoiceModelSource {
  type: 'hf' | 'github' | 'mirror';
  repo?: string;
  revision?: string;
  ref?: string;
  url?: string;
  archive?: 'zip' | 'tar.gz';
}

export interface VoiceModelManifestEntry {
  id: string;
  tier: VoiceAssetTier;
  kind: VoiceDownloadedAsset['kind'] | 'vad' | 'stt' | 'tts';
  target: string;
  displayName?: string;
  sizeMB?: number;
  license?: string;
  sha256?: string | null;
  aliasOf?: string;
  alsoInstalls?: string[];
  sources: VoiceModelSource[];
}

export interface VoiceModelsManifest {
  version: number;
  assets: VoiceModelManifestEntry[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveVoiceManifestPath(): string | null {
  const fromEnv = process.env['AGENTX_VOICE_MANIFEST_PATH'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const bundleDir = process.env['AGENTX_VOICE_BUNDLE_DIR'];
  if (bundleDir) {
    const bundledManifest = join(bundleDir, '..', 'voice-models.manifest.json');
    if (existsSync(bundledManifest)) return bundledManifest;
  }

  const candidates = [
    resolve(__dirname, 'voice-models.manifest.json'),
    resolve(__dirname, '..', '..', 'voice-sidecar', 'voice-models.manifest.json'),
    resolve(__dirname, '..', '..', '..', 'voice-sidecar', 'voice-models.manifest.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readBundleInfoSha256(bundleDir: string, assetId: string): string | undefined {
  try {
    const infoPath = join(bundleDir, 'bundle-info.json');
    if (!existsSync(infoPath)) return undefined;
    const info = JSON.parse(readFileSync(infoPath, 'utf8')) as {
      assets?: Record<string, { sha256?: string }>;
    };
    return info.assets?.[assetId]?.sha256;
  } catch {
    return undefined;
  }
}

export function loadVoiceModelsManifest(): VoiceModelsManifest {
  const manifestPath = resolveVoiceManifestPath();
  if (!manifestPath) {
    throw new Error('voice-models.manifest.json not found');
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as VoiceModelsManifest;
  } catch (error) {
    getLogger().warn('VOICE_ASSET_MANIFEST', `Failed to parse voice models manifest: ${error instanceof Error ? error.message : String(error)}`);
    return { version: 0, assets: [] };
  }
}

export function resolveVoiceBundleDir(): string | null {
  const fromEnv = process.env['AGENTX_VOICE_BUNDLE_DIR'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return null;
}

export function getManifestEntry(manifest: VoiceModelsManifest, assetId: string): VoiceModelManifestEntry | undefined {
  return manifest.assets.find((entry) => entry.id === assetId);
}

export function getDefaultDownloadAssetIds(manifest: VoiceModelsManifest): string[] {
  return manifest.assets
    .filter((entry) => entry.tier === 'download' && !entry.aliasOf)
    .map((entry) => entry.id);
}

export function getBundledAssetIds(manifest: VoiceModelsManifest): string[] {
  return manifest.assets.filter((entry) => entry.tier === 'bundled').map((entry) => entry.id);
}

async function registerInstalledAsset(
  entry: VoiceModelManifestEntry,
  targetPath: string,
  addAsset: (asset: VoiceDownloadedAsset) => void,
): Promise<VoiceDownloadedAsset> {
  const kind = normalizeManifestKind(entry.kind);
  const sha256 = entry.sha256 ?? await computeDirectorySha256(targetPath);
  const installed: VoiceDownloadedAsset = {
    assetId: entry.id,
    kind,
    version: `manifest-v${entry.id}`,
    installedAt: new Date().toISOString(),
    sha256,
  };
  addAsset(installed);
  return installed;
}

function normalizeManifestKind(kind: VoiceModelManifestEntry['kind']): VoiceDownloadedAsset['kind'] {
  switch (kind) {
    case 'vad':
      return 'vad-model';
    case 'stt':
      return 'stt-model';
    case 'tts':
      return 'tts-model';
    default:
      return kind;
  }
}

export async function bootstrapBundledVoiceAssets(options: {
  manifest: VoiceModelsManifest;
  bundleDir: string;
  dataDir: string;
  getConfig: () => VoiceConfig;
  addAsset: (asset: VoiceDownloadedAsset) => void;
}): Promise<string[]> {
  const bootstrapped: string[] = [];

  for (const entry of options.manifest.assets) {
    if (entry.tier !== 'bundled') continue;
    if (isVoiceAssetInstalled(options.getConfig(), entry.id)) continue;

    const bundledPath = join(options.bundleDir, entry.id);
    if (!existsSync(bundledPath)) continue;

    const targetPath = join(options.dataDir, entry.target);
    if (!existsSync(targetPath)) {
      cpSync(bundledPath, targetPath, { recursive: true });
    }

    const pinnedSha256 = readBundleInfoSha256(options.bundleDir, entry.id);
    const entryWithSha = pinnedSha256 ? { ...entry, sha256: pinnedSha256 } : entry;
    await registerInstalledAsset(entryWithSha, targetPath, options.addAsset);
    bootstrapped.push(entry.id);

    for (const aliasId of entry.alsoInstalls ?? []) {
      const aliasEntry = getManifestEntry(options.manifest, aliasId);
      if (!aliasEntry || isVoiceAssetInstalled(options.getConfig(), aliasId)) continue;
      await registerInstalledAsset(aliasEntry, targetPath, options.addAsset);
      bootstrapped.push(aliasId);
    }
  }

  return bootstrapped;
}

export async function registerAliasAssets(
  manifest: VoiceModelsManifest,
  primaryAssetId: string,
  dataDir: string,
  getConfig: () => VoiceConfig,
  addAsset: (asset: VoiceDownloadedAsset) => void,
): Promise<string[]> {
  const primary = getManifestEntry(manifest, primaryAssetId);
  if (!primary) return [];

  const registered: string[] = [];
  const targetPath = join(dataDir, primary.target);
  if (!existsSync(targetPath)) return registered;

  for (const aliasId of primary.alsoInstalls ?? []) {
    const aliasEntry = getManifestEntry(manifest, aliasId);
    if (!aliasEntry || isVoiceAssetInstalled(getConfig(), aliasId)) continue;
    await registerInstalledAsset(aliasEntry, targetPath, addAsset);
    registered.push(aliasId);
  }

  return registered;
}
