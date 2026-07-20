import { existsSync } from 'node:fs';
import { type VoiceCapabilityStatus, type VoiceConfig, type VoiceDownloadedAsset } from '@agentx/shared';
import {
  VOICE_ASSET_CATALOG,
  bootstrapBundledVoiceAssets,
  getBundledAssetIds,
  getDefaultDownloadAssetIds,
  getManifestEntry,
  isVoiceAssetInstalled,
  loadVoiceModelsManifest,
  mergeVoiceConfig,
  registerAliasAssets,
  resolveVoiceBundleDir,
} from '@agentx/engine';
import { getEngine } from '../engine.js';
import {
  type VoiceSetupStatus,
  voiceState,
  voiceInfo,
  voiceWarn,
  voiceDebug,
  voiceError,
  logVoiceEnvironment,
  execVoiceCommand,
  formatExecError,
  resolvePythonExecutable,
  resolveFfmpegExecutable,
  venvPython,
  SIDE_CAR_PACKAGE_DIR,
  installVoiceDependencies,
  voiceDataDir,
  pythonEnv,
  getAssetManager,
  commandAvailable,
  detectCudaEnv,
} from './shared.js';

function resolveSetupAssetIds(): string[] {
  try {
    const manifest = loadVoiceModelsManifest();
    return [...getBundledAssetIds(manifest), ...getDefaultDownloadAssetIds(manifest)];
  } catch {
    return ['silero-vad', 'faster-distil-whisper-small.en', 'kokoro-onnx', 'kokoro-af'];
  }
}

function resolveSetupCatalogEntries() {
  const ids = resolveSetupAssetIds();
  return ids
    .map((id) => VOICE_ASSET_CATALOG.find((entry) => entry.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function formatSourceLabel(assetId: string, fallback?: string): string {
  try {
    const entry = getManifestEntry(loadVoiceModelsManifest(), assetId);
    const source = entry?.sources[0];
    if (!source) return fallback ?? assetId;
    if (source.type === 'github' && source.repo) return `GitHub · ${source.repo}`;
    if (source.type === 'hf' && source.repo) return `HuggingFace · ${source.repo}`;
    if (source.type === 'mirror' && source.url) return `Mirror · ${source.url}`;
  } catch {
    // fall through
  }
  return fallback ?? assetId;
}

async function buildVoiceCapabilities(config: VoiceConfig): Promise<VoiceCapabilityStatus> {
  const engine = config.engine ?? 'stt_llm_tts';

  // xAI realtime only needs an API key; local checks are skipped.
  if (engine === 'realtime_xai') {
    const xaiConfigured = Boolean(config.xai?.apiKey);
    return {
      os: process.platform,
      arch: process.arch,
      pythonAvailable: false,
      ffmpegAvailable: false,
      sidecar: { state: 'not-installed' as const },
      stt: { engine: 'faster-whisper', selectedModelId: undefined, selectedModelInstalled: false },
      tts: { selectedEngine: 'kokoro', selectedVoiceId: undefined, selectedVoiceInstalled: false, kokoroInstalled: false },
      vadInstalled: false,
      gpuAvailable: detectCudaEnv(),
      canRunWeb: xaiConfigured,
      canRunChannels: false,
      engine,
      realtimeXai: { configured: xaiConfigured, reachable: xaiConfigured },
    };
  }

  const [pythonAvailable, ffmpegAvailable] = await Promise.all([
    commandAvailable(resolvePythonExecutable(), ['--version']),
    commandAvailable(resolveFfmpegExecutable(), ['-version']),
  ]);

  const selectedSttModelId = config.stt?.modelId;
  const selectedTtsEngine = config.tts?.engine ?? 'kokoro';
  const selectedVoiceId = config.tts?.voiceId;

  const sttInstalled = selectedSttModelId ? isVoiceAssetInstalled(config, selectedSttModelId) : false;
  const kokoroInstalled = isVoiceAssetInstalled(config, 'kokoro-onnx');
  // All 54 Kokoro voices are bundled inside voices-v1.0.bin (part of the kokoro-onnx asset).
  // So any voice ID is installed as long as kokoro-onnx is installed.
  // Only the legacy "kokoro-af" alias is a separate downloaded asset.
  const selectedVoiceInstalled = kokoroInstalled
    || (selectedVoiceId ? isVoiceAssetInstalled(config, selectedVoiceId) : false);
  const selectedTtsInstalled = kokoroInstalled && selectedVoiceInstalled;
  const vadInstalled = isVoiceAssetInstalled(config, 'silero-vad');
  const sidecarDepsInstalled = kokoroInstalled || sttInstalled || vadInstalled;
  const canRunBase = pythonAvailable && ffmpegAvailable && sidecarDepsInstalled && sttInstalled && selectedTtsInstalled && vadInstalled;

  let sidecarState: VoiceCapabilityStatus['sidecar'] = {
    state: config.enabled && pythonAvailable ? 'stopped' : 'not-installed',
    error: pythonAvailable ? undefined : 'python3 is required for the local voice sidecar',
  };
  if (config.enabled && voiceState.sidecarManager) {
    const status = voiceState.sidecarManager.getStatus();
    sidecarState = {
      state: status.state,
      error: status.error,
    };
  }

  return {
    os: process.platform,
    arch: process.arch,
    pythonAvailable,
    ffmpegAvailable,
    sidecar: sidecarState,
    stt: {
      engine: 'faster-whisper',
      selectedModelId: selectedSttModelId,
      selectedModelInstalled: sttInstalled,
    },
    tts: {
      selectedEngine: selectedTtsEngine,
      selectedVoiceId,
      selectedVoiceInstalled,
      kokoroInstalled,
    },
    vadInstalled,
    gpuAvailable: detectCudaEnv(),
    canRunWeb: canRunBase && config.enabled !== false,
    canRunChannels: canRunBase && config.mode?.channels !== 'off',
    engine,
  };
}

function getVoiceConfig(): VoiceConfig {
  const cfg = getEngine().configManager.load();
  return mergeVoiceConfig(cfg.voice);
}

function addDownloadedAsset(asset: VoiceDownloadedAsset): void {
  const eng = getEngine();
  const cfg = eng.configManager.load();
  const voice = mergeVoiceConfig(cfg.voice);
  eng.configManager.save({
    ...cfg,
    voice: {
      ...voice,
      downloadedAssets: [
        ...(voice.downloadedAssets ?? []).filter((entry) => entry.assetId !== asset.assetId),
        asset,
      ],
    },
  });
}

function removeDownloadedAsset(assetId: string): void {
  const eng = getEngine();
  const cfg = eng.configManager.load();
  const voice = mergeVoiceConfig(cfg.voice);
  eng.configManager.save({
    ...cfg,
    voice: {
      ...voice,
      downloadedAssets: (voice.downloadedAssets ?? []).filter((entry) => entry.assetId !== assetId),
    },
  });
}

async function ensureVoiceRuntimeReady(): Promise<void> {
  logVoiceEnvironment('ensure-prepare');
  if (!existsSync(SIDE_CAR_PACKAGE_DIR)) {
    throw new Error(`Voice sidecar package missing — reinstall Agent-X or run Settings → Voice → Deploy voice kit`);
  }

  const venvPy = venvPython();
  const checkImport = async (): Promise<boolean> => {
    if (!existsSync(venvPy)) return false;
    try {
      await execVoiceCommand(venvPy, ['-c', 'import agentx_voice'], {
        label: 'check-agentx-voice-import',
        timeout: 15_000,
        env: pythonEnv(),
      });
      return true;
    } catch {
      return false;
    }
  };

  if (!(await checkImport())) {
    voiceInfo('Voice runtime not ready — installing Python dependencies');
    voiceState.sidecarManager = null;
    const { resetVoiceService } = await import('../voice-runtime.js');
    resetVoiceService();
    await installVoiceDependencies();
    if (!(await checkImport())) {
      throw new Error('Voice Python environment failed to install — open Settings → Voice and run Deploy voice kit');
    }
  }
}

function formatEnsureError(raw: string): string {
  if (raw.includes('fetch failed') || raw.includes('ECONNREFUSED')) {
    return 'Voice engine offline — complete setup in Settings → Voice';
  }
  if (raw.includes('No module named')) {
    return 'Voice Python environment incomplete — open Settings → Voice and run Deploy voice kit';
  }
  if (raw.includes('Timed out waiting for voice sidecar')) {
    return 'Voice engine timed out starting — retry or check Settings → Voice';
  }
  return raw;
}

const RUNTIME_SETUP_STEPS = 3;

let lastLoggedSetupKey = '';
let lastLoggedSetupProgress = -1;

function patchVoiceSetupStatus(patch: Partial<VoiceSetupStatus>): void {
  voiceState.setupStatus = { ...voiceState.setupStatus, ...patch };

  // High-frequency callers (pip output lines, download progress ticks) hit
  // this on every update. Only log when the phase/step/message changes, an
  // error appears, or progress advances by >= 5% — otherwise the log floods
  // with near-identical entries.
  const key = `${voiceState.setupStatus.phase}|${voiceState.setupStatus.step ?? ''}|${voiceState.setupStatus.message}|${voiceState.setupStatus.error ?? ''}`;
  const progressJump = Math.abs(voiceState.setupStatus.progress - lastLoggedSetupProgress) >= 5;
  if (key === lastLoggedSetupKey && !progressJump) {
    voiceDebug('Voice setup progress (tick)', {
      progress: voiceState.setupStatus.progress,
      detail: voiceState.setupStatus.detail,
      assetProgress: voiceState.setupStatus.assetProgress,
    });
    return;
  }
  lastLoggedSetupKey = key;
  lastLoggedSetupProgress = voiceState.setupStatus.progress;

  voiceInfo('Voice setup progress', {
    phase: voiceState.setupStatus.phase,
    step: voiceState.setupStatus.step,
    stepIndex: voiceState.setupStatus.stepIndex,
    totalSteps: voiceState.setupStatus.totalSteps,
    progress: voiceState.setupStatus.progress,
    message: voiceState.setupStatus.message,
    detail: voiceState.setupStatus.detail,
    currentAsset: voiceState.setupStatus.currentAsset,
    assetProgress: voiceState.setupStatus.assetProgress,
    error: voiceState.setupStatus.error,
  });
}

async function runVoiceSetup(): Promise<void> {
  voiceState.setupRunning = true;
  voiceInfo('Voice deployment started');
  logVoiceEnvironment('deployment-start');

  let cfg = getVoiceConfig();
  let manifest;
  try {
    manifest = loadVoiceModelsManifest();
    voiceInfo('Loaded voice models manifest', { version: manifest.version, assets: manifest.assets.length });
  } catch (error) {
    voiceError('Failed to load voice models manifest', error);
    throw error;
  }

  const assets = resolveSetupCatalogEntries();
  const totalSteps = RUNTIME_SETUP_STEPS + assets.length;
  voiceInfo('Voice deployment plan', {
    assets: assets.map((asset) => asset.id),
    totalSteps,
    installed: cfg.downloadedAssets?.map((entry) => entry.assetId) ?? [],
  });

  patchVoiceSetupStatus({
    phase: 'runtime',
    step: 'Runtime check',
    stepIndex: 1,
    totalSteps,
    message: 'Checking Python and ffmpeg…',
    detail: `Python: ${resolvePythonExecutable()}`,
    progress: 1,
    currentAsset: undefined,
    currentAssetName: undefined,
    assetIndex: undefined,
    totalAssets: assets.length,
    assetProgress: undefined,
  });

  try {
    const [pythonAvailable, ffmpegAvailable] = await Promise.all([
      commandAvailable(resolvePythonExecutable(), ['--version']),
      commandAvailable(resolveFfmpegExecutable(), ['-version']),
    ]);
    if (!pythonAvailable) {
      throw new Error('Python 3 is required. Install Python 3.10+ and retry.');
    }
    if (!ffmpegAvailable) {
      throw new Error(
        'ffmpeg is required but was not found. Reinstall Agent-X (bundled ffmpeg missing), '
        + 'or install a system ffmpeg and ensure it is on PATH, then retry.',
      );
    }

    const bundleDir = resolveVoiceBundleDir();
    if (bundleDir) {
      patchVoiceSetupStatus({
        phase: 'runtime',
        step: 'Bundled assets',
        stepIndex: 2,
        message: 'Installing bundled voice models…',
        detail: `Copying from ${bundleDir}`,
        progress: 3,
      });
      voiceInfo('Bootstrapping bundled voice assets', { bundleDir, voiceDataDir: voiceDataDir() });
      const bootstrapped = await bootstrapBundledVoiceAssets({
        manifest,
        bundleDir,
        dataDir: voiceDataDir(),
        getConfig: getVoiceConfig,
        addAsset: addDownloadedAsset,
      });
      voiceInfo('Bundled voice assets bootstrapped', { bootstrapped });
      if (bootstrapped.length > 0) {
        patchVoiceSetupStatus({
          phase: 'runtime',
          step: 'Bundled assets',
          stepIndex: 2,
          message: 'Bundled models ready',
          detail: bootstrapped.join(', '),
          progress: 6,
        });
        cfg = getVoiceConfig();
      }
    } else {
      voiceWarn('No bundled voice assets directory found; downloads will be used instead');
    }

    patchVoiceSetupStatus({
      phase: 'runtime',
      step: 'Python environment',
      stepIndex: 2,
      message: 'Preparing voice Python environment…',
      detail: existsSync(venvPython()) ? 'Reusing existing virtualenv' : 'Creating new virtualenv',
      progress: 8,
    });

    await installVoiceDependencies((detail, subProgress) => {
      patchVoiceSetupStatus({
        phase: 'runtime',
        step: 'Engine install',
        stepIndex: 3,
        message: 'Installing voice engine packages…',
        detail,
        progress: 4 + subProgress,
      });
    });

    patchVoiceSetupStatus({
      phase: 'runtime',
      step: 'Engine install',
      stepIndex: 3,
      message: 'Voice engine ready',
      detail: 'Sidecar dependencies installed',
      progress: 15,
    });

    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]!;
      const assetStepIndex = RUNTIME_SETUP_STEPS + index + 1;
      const baseProgress = 15 + Math.round((index / assets.length) * 80);

      if (isVoiceAssetInstalled(cfg, asset.id)) {
        patchVoiceSetupStatus({
          phase: 'download',
          step: asset.deliveryTier === 'bundled' ? 'Bundled assets' : 'Model download',
          stepIndex: assetStepIndex,
          message: `${asset.displayName} already installed`,
          detail: asset.deliveryTier === 'bundled'
            ? `Bundled copy ready at ${getAssetManager().assetPath(asset)}`
            : `Skipped — cached at ${getAssetManager().assetPath(asset)}`,
          progress: baseProgress + Math.round(80 / assets.length),
          currentAsset: asset.id,
          currentAssetName: asset.displayName,
          assetIndex: index + 1,
          totalAssets: assets.length,
          assetProgress: 100,
        });
        continue;
      }

      // Model files may already exist on disk without a config entry (e.g. the
      // config was reset). Re-register instead of re-downloading.
      if (await getAssetManager().isInstalled(asset.id)) {
        voiceInfo('Asset found on disk; re-registering without download', { assetId: asset.id });
        addDownloadedAsset({
          assetId: asset.id,
          kind: asset.kind,
          engine: asset.engine,
          version: asset.downloadUrl,
          installedAt: new Date().toISOString(),
        });
        await registerAliasAssets(manifest, asset.id, voiceDataDir(), getVoiceConfig, addDownloadedAsset);
        cfg = getVoiceConfig();
        patchVoiceSetupStatus({
          phase: 'download',
          step: 'Model download',
          stepIndex: assetStepIndex,
          message: `${asset.displayName} restored from disk`,
          detail: `Found at ${getAssetManager().assetPath(asset)}`,
          progress: baseProgress + Math.round(80 / assets.length),
          currentAsset: asset.id,
          currentAssetName: asset.displayName,
          assetIndex: index + 1,
          totalAssets: assets.length,
          assetProgress: 100,
        });
        continue;
      }

      if (asset.deliveryTier === 'bundled') {
        continue;
      }

      const manifestEntry = getManifestEntry(manifest, asset.id);
      if (manifestEntry?.aliasOf && isVoiceAssetInstalled(getVoiceConfig(), manifestEntry.aliasOf)) {
        await registerAliasAssets(manifest, manifestEntry.aliasOf, voiceDataDir(), getVoiceConfig, addDownloadedAsset);
        continue;
      }

      const sourceLabel = formatSourceLabel(asset.id, asset.downloadUrl);

      patchVoiceSetupStatus({
        phase: 'download',
        step: 'Model download',
        stepIndex: assetStepIndex,
        message: `Downloading ${asset.displayName}…`,
        detail: `${sourceLabel} · ~${asset.sizeMB ?? '?'} MB`,
        progress: baseProgress,
        currentAsset: asset.id,
        currentAssetName: asset.displayName,
        assetIndex: index + 1,
        totalAssets: assets.length,
        assetProgress: 0,
      });

      voiceInfo('Starting asset download', { assetId: asset.id, source: sourceLabel, sizeMB: asset.sizeMB });

      try {
        const installed = await getAssetManager().downloadAsset(asset, (progress) => {
        const assetSlice = 80 / assets.length;
        const mapped = baseProgress + Math.round(((progress.progress ?? 0) / 100) * assetSlice);
        const detail = progress.status === 'verifying'
          ? `Verifying checksum for ${asset.displayName}…`
          : progress.status === 'running'
            ? `Fetching ${asset.displayName} from ${sourceLabel}`
            : progress.error ?? `Downloading ${asset.displayName}…`;

        if (progress.error) {
          voiceWarn('Asset download progress reported error', { assetId: asset.id, error: progress.error });
        }

        patchVoiceSetupStatus({
          phase: 'download',
          step: 'Model download',
          stepIndex: assetStepIndex,
          message: progress.status === 'verifying'
            ? `Verifying ${asset.displayName}…`
            : `Downloading ${asset.displayName}…`,
          detail,
          progress: mapped,
          currentAsset: asset.id,
          currentAssetName: asset.displayName,
          assetIndex: index + 1,
          totalAssets: assets.length,
          assetProgress: progress.progress,
        });
        });
        voiceInfo('Asset downloaded', { assetId: asset.id, sha256: installed.sha256, sizeBytes: installed.sizeBytes });
        addDownloadedAsset(installed);
      } catch (error) {
        voiceError(`Asset download failed: ${asset.id}`, error, {
          assetId: asset.id,
          source: sourceLabel,
          path: getAssetManager().assetPath(asset),
        });
        throw error;
      }
      await registerAliasAssets(manifest, asset.id, voiceDataDir(), getVoiceConfig, addDownloadedAsset);
      cfg = getVoiceConfig();
    }

    patchVoiceSetupStatus({
      phase: 'complete',
      step: 'Complete',
      stepIndex: totalSteps,
      message: 'Voice kit ready.',
      detail: `${assets.length} models installed · sidecar ready`,
      progress: 100,
      assetProgress: 100,
    });
    voiceInfo('Voice deployment completed successfully');
  } catch (error) {
    const message = formatExecError(error);
    voiceError('Voice deployment failed', error, {
      progress: voiceState.setupStatus.progress,
      step: voiceState.setupStatus.step,
      detail: voiceState.setupStatus.detail,
      currentAsset: voiceState.setupStatus.currentAsset,
    });
    patchVoiceSetupStatus({
      phase: 'error',
      message: 'Voice setup failed',
      detail: message,
      progress: voiceState.setupStatus.progress,
      error: message,
    });
  } finally {
    voiceState.setupRunning = false;
    voiceInfo('Voice deployment finished', { running: false, phase: voiceState.setupStatus.phase });
  }
}

export {
  resolveSetupAssetIds,
  resolveSetupCatalogEntries,
  formatSourceLabel,
  buildVoiceCapabilities,
  getVoiceConfig,
  addDownloadedAsset,
  removeDownloadedAsset,
  ensureVoiceRuntimeReady,
  formatEnsureError,
  patchVoiceSetupStatus,
  runVoiceSetup,
};
