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
  ensureVoiceDownloadRuntime,
} from './shared.js';
import {
  getVoiceConfig,
  buildVoiceCapabilities,
  addDownloadedAsset,
  removeDownloadedAsset,
  runVoiceSetup,
  ensureVoiceRuntimeReady,
  formatEnsureError,
  reconcileVoiceKitState,
} from './setup.js';

const PASSAGE_FALLBACK = 'The quick brown fox jumps over the lazy dog.';

const PASSAGES = [
  'The morning sun rose over the quiet village, painting the hills in shades of gold. A gentle breeze carried the scent of fresh bread through the narrow streets. Children laughed as they chased one another toward the old stone bridge.',
  'Maya opened the book and let the story carry her across the sea. Waves crashed against the cliffs while gulls cried overhead. She imagined the salty air and the creak of wooden sails in the wind.',
  'The garden was full of colour after the spring rain. Bright tulips stood beside the fence while bees moved from bloom to bloom. A small cat watched from the porch, perfectly still in the sunlight.',
  'Every Sunday, Leo walked to the market to buy fresh fruit and strong coffee. The vendors called out their best prices as music played from a nearby corner. He always stopped to listen for a little while.',
  'A single red balloon floated above the crowd in the town square. Families gathered near the fountain, eating ice cream and sharing stories. The clock tower chimed three, and the pigeons scattered into the sky.',
  'The train rolled through green fields and past sleepy villages. Passengers dozed beside foggy windows while the conductor checked tickets with a friendly nod. Outside, sheep moved slowly across the hillside.',
  'Nora set her easel beneath the oak tree and mixed her favourite blue. The lake shimmered in the distance, bordered by tall reeds and wildflowers. She painted until the light became too soft to trust.',
  'The bakery smelled of cinnamon, sugar, and warm dough. An old clock ticked above the counter as the baker arranged croissants on a wooden tray. Customers chatted quietly while rain tapped the window.',
  'High in the mountains, the air was clean and cold. Hikers followed a narrow trail between pine trees and over rocky streams. Each step revealed a wider view of the valley far below.',
  'The library was silent except for the turning of pages. Dust drifted through the tall windows, catching the afternoon light. Somewhere in the stacks, a chair scraped softly against the wooden floor.',
  'Jamie sat on the dock and dangled his feet above the still water. Dragonflies hovered and darted among the reeds. He could hear the distant hum of a motorboat and the call of a loon.',
  'Autumn leaves crunched beneath her boots as she walked the forest path. The trees wore crowns of orange, red, and yellow. A squirrel paused on a branch, watching her with bright, curious eyes.',
  'The café was small and warm, with soft music and the clink of cups. Outside, snow began to fall, slowly covering the bicycles parked along the street. She wrapped her hands around her mug and smiled.',
  'Omar pushed his bicycle along the winding coastal road. The ocean stretched out to the horizon, bright and endless. Seagulls wheeled above the cliffs, their cries lost in the sound of the waves.',
  'The kitchen filled with the rich smell of garlic, tomatoes, and fresh basil. Grandmother stirred the sauce while the pasta pot bubbled beside her. Everyone knew dinner would be late, and no one minded.',
  'Stars appeared one by one as the village lights went out. A dog barked somewhere in the distance, then stopped. The night was cool and clear, perfect for walking beneath the moon.',
  'Elena found an old map in the attic, folded inside a leather envelope. Faint lines marked rivers, forests, and a village that no longer appeared on modern charts. She wondered what stories it still held.',
  'The workshop smelled of sawdust and oil. Tools hung in neat rows on the wall, each one worn by years of careful work. A radio played quietly in the corner while he sanded the edge of a chair.',
  'Rain filled the streets with shallow puddles that reflected the neon signs. People hurried past under umbrellas, their footsteps splashing in rhythm. A bus stopped with a hiss, and the doors folded open.',
  'The lighthouse beam swept across the dark water in slow, steady turns. Below, the waves rolled against the rocks with a sound older than memory. A ship moved along the horizon, small and patient.',
];

function pickRandomPassage(): { text: string; fallback?: boolean } {
  const text = PASSAGES[Math.floor(Math.random() * PASSAGES.length)] ?? PASSAGE_FALLBACK;
  return { text };
}

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
      await reconcileVoiceKitState();
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

    voiceJobStatuses.set(assetId, {
      status: 'running',
      progress: 0,
      detail: 'Preparing Python environment…',
    });

    void (async () => {
      try {
        await ensureVoiceDownloadRuntime((detail, progress) => {
          voiceJobStatuses.set(assetId, { status: 'running', progress, detail });
        });
        const installed = await getAssetManager().downloadAsset(asset, (progress) => {
          voiceJobStatuses.set(assetId, {
            status: progress.status,
            progress: progress.progress,
            error: progress.error,
            detail: progress.detail,
            downloadedMB: progress.downloadedMB,
            totalMB: progress.totalMB,
          });
        });
        addDownloadedAsset(installed);
        try {
          const manifest = loadVoiceModelsManifest();
          await registerAliasAssets(manifest, assetId, voiceDataDir(), getVoiceConfig, addDownloadedAsset);
        } catch (error) {
          voiceError('Failed to register alias assets after download', error, { assetId });
        }
        voiceJobStatuses.set(assetId, { status: 'complete', progress: 100 });
      } catch (error) {
        voiceJobStatuses.set(assetId, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

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

  router.post('/voice/passage', async (_req, res) => {
    res.json(pickRandomPassage());
  });

  router.post('/voice/passage/stream', async (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(pickRandomPassage().text);
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

  router.get('/voice/speakers', async (_req, res) => {
    try {
      const client = await getVoiceSidecarManager().start();
      const result = await client.speakerList();
      res.json({ profiles: result.profiles });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list voiceprints' });
    }
  });

  router.post('/voice/speakers', async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const pcmBase64 = typeof req.body?.pcmBase64 === 'string' ? req.body.pcmBase64 : '';
    const isRoot = req.body?.isRoot === true;
    const sampleRate = typeof req.body?.sampleRate === 'number' ? req.body.sampleRate : 16_000;
    const profileId = typeof req.body?.profileId === 'string' ? req.body.profileId : undefined;
    if (!pcmBase64) {
      return res.status(400).json({ error: 'pcmBase64 is required' });
    }
    if (!profileId && !name) {
      return res.status(400).json({ error: 'name is required for a new profile' });
    }
    try {
      const client = await getVoiceSidecarManager().start();
      const result = await client.speakerEnroll({ name, pcm: pcmBase64, sampleRate, isRoot, profileId });
      res.json({ profile: result.profile });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to enroll voiceprint' });
    }
  });

  router.post('/voice/speakers/:id/root', async (req, res) => {
    const profileId = String(req.params.id ?? '');
    if (!profileId) {
      return res.status(400).json({ error: 'profileId is required' });
    }
    try {
      const client = await getVoiceSidecarManager().start();
      const result = await client.speakerSetRoot({ profileId });
      res.json({ profile: result.profile });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to set root voiceprint' });
    }
  });

  router.patch('/voice/speakers/:id', async (req, res) => {
    const profileId = String(req.params.id ?? '');
    const name = String(req.body?.name ?? '').trim();
    if (!profileId) {
      return res.status(400).json({ error: 'profileId is required' });
    }
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    try {
      const { getVoiceService } = await import('../voice-runtime.js');
      const profile = await getVoiceService().updateSpeaker(profileId, name);
      res.json({ profile });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update voiceprint' });
    }
  });

  router.delete('/voice/speakers/:id', async (req, res) => {
    const profileId = String(req.params.id ?? '');
    if (!profileId) {
      return res.status(400).json({ error: 'profileId is required' });
    }
    try {
      const client = await getVoiceSidecarManager().start();
      const result = await client.speakerDelete({ profileId });
      res.json({ ok: result.ok });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete voiceprint' });
    }
  });

  router.delete('/voice/speakers/:id/samples/:sampleId', async (req, res) => {
    const profileId = String(req.params.id ?? '');
    const sampleId = String(req.params.sampleId ?? '');
    if (!profileId || !sampleId) {
      return res.status(400).json({ error: 'profileId and sampleId are required' });
    }
    try {
      const { getVoiceService } = await import('../voice-runtime.js');
      const ok = await getVoiceService().deleteSpeakerSample(profileId, sampleId);
      res.json({ ok });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete sample' });
    }
  });

  router.post('/voice/speakers/identify', async (req, res) => {
    const pcmBase64 = typeof req.body?.pcmBase64 === 'string' ? req.body.pcmBase64 : '';
    const sampleRate = typeof req.body?.sampleRate === 'number' ? req.body.sampleRate : 16_000;
    const threshold = typeof req.body?.threshold === 'number' ? req.body.threshold : 0.55;
    if (!pcmBase64) {
      return res.status(400).json({ error: 'pcmBase64 is required' });
    }
    try {
      const client = await getVoiceSidecarManager().start();
      const result = await client.speakerIdentify({ pcm: pcmBase64, sampleRate, threshold });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to identify speaker' });
    }
  });

  router.post('/voice/speakers/reset', async (_req, res) => {
    try {
      const { getVoiceService } = await import('../voice-runtime.js');
      const ok = await getVoiceService().resetSpeakers();
      res.json({ ok });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to reset voiceprints' });
    }
  });

  router.post('/voice/speakers/:id/re-record', async (req, res) => {
    const profileId = String(req.params.id ?? '');
    const pcmBase64 = typeof req.body?.pcmBase64 === 'string' ? req.body.pcmBase64 : '';
    if (!profileId) {
      return res.status(400).json({ error: 'profileId is required' });
    }
    if (!pcmBase64) {
      return res.status(400).json({ error: 'pcmBase64 is required' });
    }
    try {
      const { getVoiceService } = await import('../voice-runtime.js');
      const service = getVoiceService();
      const store = service.getSpeakerService();
      if (!store) {
        return res.status(503).json({ error: 'Voice sidecar not ready' });
      }
      const existing = (await store.list()).find((p) => p.id === profileId);
      if (!existing) {
        return res.status(404).json({ error: 'Speaker not found' });
      }
      const pcm = Buffer.from(pcmBase64, 'base64');
      const wasRoot = existing.isRoot;
      await store.delete(profileId);
      const profile = await store.add(existing.name, pcm, 16_000, wasRoot);
      res.json({ profile });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to re-record voiceprint' });
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
