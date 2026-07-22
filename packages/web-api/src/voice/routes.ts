import { Router } from 'express';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { VOICE_ASSET_CATALOG, mergeVoiceConfig, registerAliasAssets, loadVoiceModelsManifest, getPersonaStore } from '@agentx/engine';
import type { VoiceConfig } from '@agentx/shared';
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

function pickVoiceGreetingFallback(callsign: string, agentName: string): string {
  const fallbacks = callsign
    ? [
        `${agentName} here, ${callsign}. Voice is live — what's on your mind?`,
        `Hey ${callsign}, ${agentName} online. Ready when you are.`,
        `${callsign}, ${agentName} speaking. Audio channel is open.`,
        `Voice is up, ${callsign}. ${agentName} at your service.`,
      ]
    : [
        `${agentName} here. Voice comms are online.`,
        `Audio channel open. ${agentName} standing by.`,
        `Voice systems online. ${agentName} ready to help.`,
        `${agentName} online. What can I do for you?`,
      ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
}

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
        stt: 'faster-distil-whisper-small.en',
        tts: 'kokoro-onnx',
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
        detail: progress.detail,
        downloadedMB: progress.downloadedMB,
        totalMB: progress.totalMB,
      });
    })
      .then(async (installed) => {
        addDownloadedAsset(installed);
        // Register alias assets (e.g. kokoro-af for kokoro-onnx)
        try {
          const manifest = loadVoiceModelsManifest();
          await registerAliasAssets(manifest, assetId, voiceDataDir(), getVoiceConfig, addDownloadedAsset);
        } catch (error) {
          voiceError('Failed to register alias assets after download', error, { assetId });
        }
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
    // Check voiceJobStatuses first — it's always current for the specific download.
    // getAssetManager().getJob() may have stale state from a previous download.
    const job = voiceJobStatuses.get(assetId) ?? getAssetManager().getJob(assetId);
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

  router.post('/voice/greeting', async (req, res) => {
    try {
      const engine = getEngine();
      const config = engine.configManager.load();
      const callsign = String(req.body?.callsign ?? '').trim();
      const persona = getPersonaStore().get();
      const agentName = persona?.name ?? 'Agent-X';
      const { createAiSdkModel } = await import('@agentx/engine');
      const { generateText } = await import('ai');
      const model = createAiSdkModel(config);
      const userPart = callsign ? ` Address the user as ${callsign}.` : '';
      const result = await generateText({
        model,
        prompt: `You are ${agentName}, an AI assistant. Generate a single short, natural spoken greeting (1-2 sentences, under 30 words) announcing that voice comms are online. Speak as ${agentName} in first person.${userPart} Be creative and varied — do not repeat the same greeting. Sound natural and conversational, not robotic. Output only the greeting text, no quotes or labels.`,
        temperature: 1.2,
        maxOutputTokens: 60,
      });
      const greeting = result.text.trim().replace(/^["']|["']$/g, '').slice(0, 200);
      // Empty model output is a soft failure — same as LLM unavailable.
      if (!greeting) {
        const fallback = pickVoiceGreetingFallback(
          String(req.body?.callsign ?? '').trim(),
          agentName,
        );
        return res.json({ text: fallback, fallback: true });
      }
      res.json({ text: greeting });
    } catch {
      // Fallback greetings if LLM is not available
      const persona = getPersonaStore().get();
      const agentName = persona?.name ?? 'Agent-X';
      const callsign = String(req.body?.callsign ?? '').trim();
      const greeting = pickVoiceGreetingFallback(callsign, agentName);
      res.json({ text: greeting, fallback: true });
    }
  });

  router.post('/voice/preview', async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Preview text is required' });
    }
    if (text.length > 500) {
      return res.status(400).json({ error: 'Preview text must be 500 characters or less' });
    }

    const config = mergeVoiceConfig(getEngine().configManager.load().voice);
    const engine = (req.body?.engine as VoiceConfig['engine']) ?? config.engine ?? 'stt_llm_tts';
    const voiceId = typeof req.body?.voiceId === 'string' ? req.body.voiceId : undefined;

    if (engine === 'realtime_xai') {
      const apiKey = config.xai?.apiKey ?? process.env['XAI_API_KEY'];
      if (!apiKey) {
        return res.status(400).json({ error: 'xAI API key is not configured' });
      }
      try {
        const response = await fetch('https://api.x.ai/v1/tts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            voice_id: voiceId ?? config.xai?.voice ?? 'eve',
            language: 'en',
            output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 },
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          const raw = await response.text();
          return res.status(502).json({ error: `xAI TTS error: ${response.status} ${raw.slice(0, 200)}` });
        }
        const contentType = response.headers.get('content-type') ?? '';
        // xAI TTS returns raw audio bytes by default; when with_timestamps is true it returns JSON.
        if (contentType.includes('application/json')) {
          const data = await response.json() as { audio?: string };
          if (!data.audio) {
            return res.status(502).json({ error: 'xAI TTS response missing audio' });
          }
          return res.json({ audioBase64: data.audio, mimeType: 'audio/mpeg' });
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        return res.json({ audioBase64: buffer.toString('base64'), mimeType: contentType || 'audio/mpeg' });
      } catch (error) {
        return res.status(500).json({ error: error instanceof Error ? error.message : 'xAI TTS preview failed' });
      }
    }

    try {
      const tmpDir = resolve(voiceDataDir(), 'tmp');
      mkdirSync(tmpDir, { recursive: true });
      const outputPath = resolve(tmpDir, `preview-${Date.now()}.wav`);
      const client = await getVoiceSidecarManager().start();
      const result = await client.synthesize({
        text,
        engine: 'kokoro',
        voiceId,
        outputPath,
        style: req.body?.style,
      });
      const audioPath = result.audioPath ?? outputPath;
      const audio = readFileSync(audioPath);
      return res.json({
        ...result,
        audioBase64: audio.toString('base64'),
        mimeType: 'audio/wav',
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Voice preview failed' });
    }
  });

  router.post('/voice/xai/validate', async (req, res) => {
    const config = mergeVoiceConfig(getEngine().configManager.load().voice);
    let apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined;
    if (!apiKey) apiKey = config.xai?.apiKey;
    if (!apiKey) apiKey = process.env['XAI_API_KEY'];
    if (!apiKey) {
      return res.status(400).json({ valid: false, error: 'xAI API key is missing' });
    }
    try {
      // Use the realtime client_secrets endpoint to confirm the key can access
      // the Voice Agent API. We request a short-lived secret and discard it.
      const response = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expires_after: { seconds: 60 },
          model: config.xai?.model ?? 'grok-voice-latest',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        return res.json({ valid: true });
      }
      const raw = await response.text();
      return res.status(400).json({ valid: false, error: `xAI API returned ${response.status}: ${raw.slice(0, 200)}` });
    } catch (error) {
      return res.status(500).json({ valid: false, error: error instanceof Error ? error.message : 'xAI validation failed' });
    }
  });

  router.get('/voice/xai/voices', async (_req, res) => {
    const config = mergeVoiceConfig(getEngine().configManager.load().voice);
    const apiKey = config.xai?.apiKey ?? process.env['XAI_API_KEY'];
    if (!apiKey) {
      return res.status(400).json({ error: 'xAI API key is not configured' });
    }
    try {
      const response = await fetch('https://api.x.ai/v1/tts/voices', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const raw = await response.text();
        return res.status(502).json({ error: `xAI voices error: ${response.status} ${raw.slice(0, 200)}` });
      }
      const data = await response.json() as { voices?: Array<{ voice_id?: string; name?: string; language?: string | null }> };
      const voices = (data.voices ?? [])
        .filter((v) => v.voice_id && v.name)
        .map((v) => ({ id: v.voice_id, name: v.name, language: v.language ?? undefined }));
      return res.json({ voices });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch xAI voices' });
    }
  });

  return router;
}

export { createVoiceRoutesRouter };
