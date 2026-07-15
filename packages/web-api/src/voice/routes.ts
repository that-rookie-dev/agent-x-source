import { Router } from 'express';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { buildPublicSystemCapabilities } from '@agentx/shared';
import { VOICE_ASSET_CATALOG, mergeVoiceConfig } from '@agentx/engine';
import { getEngine } from '../engine.js';
import {
  voiceInfo,
  voiceError,
  formatExecError,
  voiceJobStatuses,
  voiceState,
  voiceDataDir,
  getAssetManager,
  getVoiceSidecarManager,
  ensureStyleTtsPythonInstalled,
  installVoiceDependencies,
} from './shared.js';
import {
  getVoiceConfig,
  buildVoiceCapabilities,
  addDownloadedAsset,
  removeDownloadedAsset,
  runVoiceSetup,
  ensureVoiceRuntimeReady,
  formatEnsureError,
} from './setup.js';

function createVoiceRoutesRouter(): Router {
  const router: Router = Router();

  router.get('/voice/capabilities', async (_req, res) => {
    try {
      const cfg = getVoiceConfig();
      res.json({ capabilities: await buildVoiceCapabilities(cfg) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read voice capabilities' });
    }
  });

  router.get('/voice/assets', (_req, res) => {
    const cfg = getVoiceConfig();
    res.json({
      catalog: VOICE_ASSET_CATALOG,
      installed: cfg.downloadedAssets ?? [],
      recommended: {
        stt: 'faster-whisper-base.en',
        tts: 'kokoro-82m',
        vad: 'silero-vad',
      },
    });
  });

  router.get('/voice/assets/installed', (_req, res) => {
    const cfg = getVoiceConfig();
    res.json({ assets: cfg.downloadedAssets ?? [] });
  });

  router.post('/voice/assets/download', (req, res) => {
    const assetId = String(req.body?.assetId ?? '');
    const asset = VOICE_ASSET_CATALOG.find((entry) => entry.id === assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Voice asset not found' });
    }
    if ((assetId === 'styletts2' || assetId === 'styletts2-default') &&
      !buildPublicSystemCapabilities(os.totalmem()).styleTtsSupported) {
      return res.status(400).json({ error: 'StyleTTS 2 requires at least 16 GB system RAM' });
    }

    const existing = voiceJobStatuses.get(assetId);
    if (existing?.status === 'running') {
      return res.json({ ok: true, assetId, status: 'running' });
    }

    voiceJobStatuses.set(assetId, { status: 'running', progress: 0 });
    getAssetManager().downloadAsset(asset, (progress) => {
      voiceJobStatuses.set(assetId, {
        status: progress.status,
        progress: progress.progress,
        error: progress.error,
      });
    })
      .then(async (installed) => {
        if (assetId === 'styletts2') {
          try {
            await ensureStyleTtsPythonInstalled();
          } catch (error) {
            voiceError('StyleTTS 2 Python install failed after model download', error, { assetId });
            voiceJobStatuses.set(assetId, {
              status: 'error',
              error: formatExecError(error),
            });
            return;
          }
        }
        addDownloadedAsset(installed);
        voiceJobStatuses.set(assetId, { status: 'complete', progress: 100 });
      })
      .catch((error) => {
        voiceJobStatuses.set(assetId, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      });

    res.json({ ok: true, assetId, status: 'running' });
  });

  router.post('/voice/assets/download/:assetId/cancel', (req, res) => {
    const assetId = String(req.params.assetId ?? '');
    getAssetManager().cancelDownload(assetId);
    voiceJobStatuses.set(assetId, { status: 'cancelled', error: 'Download cancelled' });
    res.json({ ok: true, assetId, status: 'cancelled' });
  });

  router.get('/voice/assets/download-status/:assetId', (req, res) => {
    const assetId = String(req.params.assetId ?? '');
    const job = getAssetManager().getJob(assetId) ?? voiceJobStatuses.get(assetId);
    res.json(job ?? { status: 'not_started' });
  });

  router.delete('/voice/assets/:assetId', async (req, res) => {
    const assetId = String(req.params.assetId ?? '');
    const asset = VOICE_ASSET_CATALOG.find((entry) => entry.id === assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Voice asset not found' });
    }

    try {
      await getAssetManager().deleteAsset(assetId);
      removeDownloadedAsset(assetId);
      voiceJobStatuses.delete(assetId);
      res.json({ ok: true, assetId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete voice asset' });
    }
  });

  router.post('/voice/install-sidecar', (_req, res) => {
    const jobId = 'sidecar-dependencies';
    if (voiceJobStatuses.get(jobId)?.status === 'running') {
      return res.json({ ok: true, jobId, status: 'running' });
    }

    voiceJobStatuses.set(jobId, { status: 'running', progress: 0 });
    installVoiceDependencies()
      .then(() => {
        voiceJobStatuses.set(jobId, { status: 'complete', progress: 100 });
        voiceInfo('Sidecar dependency install completed');
      })
      .catch((error) => {
        const message = formatExecError(error);
        voiceError('Sidecar dependency install failed', error);
        voiceJobStatuses.set(jobId, { status: 'error', error: message });
      });

    res.json({ ok: true, jobId, status: 'running' });
  });

  router.post('/voice/install-styletts', async (_req, res) => {
    try {
      await ensureStyleTtsPythonInstalled();
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: formatExecError(error) });
    }
  });

  router.post('/voice/setup', (_req, res) => {
    if (voiceState.setupRunning) {
      return res.json({ ok: true, status: voiceState.setupStatus });
    }
    void runVoiceSetup();
    res.json({ ok: true, status: voiceState.setupStatus });
  });

  router.get('/voice/setup/status', (_req, res) => {
    res.json({ status: voiceState.setupStatus });
  });

  router.get('/voice/sidecar/status', async (_req, res) => {
    try {
      const manager = getVoiceSidecarManager();
      const status = manager.getStatus();
      const client = manager.getClient();
      if (client && (status.state === 'ready' || status.state === 'starting')) {
        const health = await client.health(3_000).catch(() => undefined);
        return res.json({ sidecar: { ...status, health } });
      }
      res.json({ sidecar: status });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read sidecar status' });
    }
  });

  router.post('/voice/sidecar/ensure', async (_req, res) => {
    try {
      const config = mergeVoiceConfig(getEngine().configManager.load().voice);
      if (!config.enabled) {
        return res.status(400).json({ error: 'Voice is disabled — enable in Settings → Voice' });
      }
      const capabilities = await buildVoiceCapabilities(config);
      if (!capabilities.canRunWeb) {
        return res.status(503).json({
          ok: false,
          error: 'Voice kit incomplete — open Settings → Voice and run Deploy voice kit',
        });
      }
      await ensureVoiceRuntimeReady();
      const { getVoiceService } = await import('../voice-runtime.js');
      await getVoiceService().start();
      const manager = getVoiceSidecarManager();
      const status = manager.getStatus();
      const client = manager.getClient();
      const health = client ? await client.health(5_000) : undefined;
      res.json({
        ok: true,
        sidecar: { ...status, health },
      });
    } catch (error) {
      const raw = formatExecError(error);
      voiceError('sidecar/ensure failed', error);
      res.status(503).json({
        ok: false,
        error: formatEnsureError(raw),
        detail: raw,
      });
    }
  });

  router.post('/voice/sidecar/release', async (req, res) => {
    try {
      const config = mergeVoiceConfig(getEngine().configManager.load().voice);
      const force = req.body?.force === true;
      const { countActiveVoiceWebSocketSessions } = await import('../voice-ws.js');
      if (countActiveVoiceWebSocketSessions() > 0) {
        return res.json({ ok: true, skipped: 'sessions_active' });
      }
      const { getVoiceService } = await import('../voice-runtime.js');
      const service = getVoiceService();
      if (!config.enabled || force) {
        await service.stop();
        return res.json({ ok: true, stopped: true });
      }
      if (config.sidecar?.autoStart === true) {
        return res.json({ ok: true, skipped: 'always_on' });
      }
      service.requestIdleUnload();
      res.json({ ok: true, scheduled: true });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to release voice sidecar',
      });
    }
  });

  router.post('/voice/preview', async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    const engine = req.body?.engine === 'styletts2' ? 'styletts2' : 'kokoro';
    const voiceId = typeof req.body?.voiceId === 'string' ? req.body.voiceId : undefined;
    if (!text) {
      return res.status(400).json({ error: 'Preview text is required' });
    }
    if (text.length > 500) {
      return res.status(400).json({ error: 'Preview text must be 500 characters or less' });
    }

    try {
      if (engine === 'styletts2') {
        if (!buildPublicSystemCapabilities(os.totalmem()).styleTtsSupported) {
          return res.status(400).json({ error: 'StyleTTS 2 requires at least 16 GB system RAM' });
        }
        await ensureStyleTtsPythonInstalled();
      }
      const tmpDir = resolve(voiceDataDir(), 'tmp');
      mkdirSync(tmpDir, { recursive: true });
      const outputPath = resolve(tmpDir, `preview-${Date.now()}.wav`);
      const client = await getVoiceSidecarManager().start();
      const result = await client.synthesize({
        text,
        engine,
        voiceId,
        outputPath,
        style: req.body?.style,
      });
      const audioPath = result.audioPath ?? outputPath;
      const audio = readFileSync(audioPath);
      res.json({
        ...result,
        audioBase64: audio.toString('base64'),
        mimeType: 'audio/wav',
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Voice preview failed' });
    }
  });

  /** Generate a short greeting via the default LLM provider for TTS playback. */
  router.post('/voice/greeting', async (req, res) => {
    const callsign = String(req.body?.callsign ?? '').trim();
    if (!callsign) {
      return res.status(400).json({ error: 'Callsign is required' });
    }
    try {
      const eng = getEngine();
      const cfg = eng.configManager.load();
      const providerId = cfg.provider.activeProvider;
      if (!providerId) {
        return res.json({ text: `Hello ${callsign}, Agent-X is online and ready.` });
      }
      const providerCfg = cfg.provider.providers[providerId];
      const apiKey = providerCfg?.apiKey || providerCfg?.profiles?.[providerCfg?.activeProfile ?? '']?.apiKey;
      if (!apiKey) {
        return res.json({ text: `Hello ${callsign}, Agent-X is online and ready.` });
      }
      const { ProviderFactory } = await import('@agentx/engine');
      const provider = ProviderFactory.create(providerId, apiKey, providerCfg?.baseUrl);
      const modelId = cfg.provider.activeModel || 'gpt-4o-mini';

      const prompt = `Generate a single short greeting sentence (max 20 words) welcoming the user to Agent-X.
Address them as "${callsign}". Be warm, confident, and slightly sci-fi in tone.
Output ONLY the greeting sentence — no quotes, no labels, no markdown.`;

      const chunks: string[] = [];
      for await (const chunk of provider.complete({
        messages: [{ role: 'user', content: prompt }],
        model: modelId,
        stream: true,
        maxTokens: 60,
        temperature: 0.7,
      })) {
        if (chunk.type === 'text_delta' && chunk.content) chunks.push(chunk.content);
      }
      const text = chunks.join('').trim().replace(/^["']|["']$/g, '').slice(0, 200);
      res.json({ text: text || `Hello ${callsign}, Agent-X is online and ready.` });
    } catch {
      res.json({ text: `Hello ${callsign}, Agent-X is online and ready.` });
    }
  });

  return router;
}

export { createVoiceRoutesRouter };
