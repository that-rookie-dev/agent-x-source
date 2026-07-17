import type { VoiceConfig } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { XaiRealtimeSession } from './XaiRealtimeSession.js';
import type { VoiceEngine, VoiceEngineSession, VoiceEngineSessionOptions } from './types.js';

export class XaiRealtimeEngine implements VoiceEngine {
  readonly type = 'realtime_xai' as const;

  async start(): Promise<void> {
    // No-op — the sidecar/STT runtime is not used.
  }

  async createSession(options: VoiceEngineSessionOptions): Promise<VoiceEngineSession> {
    const config = getEngine().configManager.load();
    const voiceConfig: VoiceConfig = config.voice ?? {};
    const apiKey = voiceConfig.xai?.apiKey ?? process.env['XAI_API_KEY'];
    if (!apiKey) {
      throw new Error('xAI API key is not configured. Add it in Settings → Voice.');
    }

    const session = new XaiRealtimeSession({
      ws: options.ws,
      transport: options.transport,
      sessionId: options.sessionId,
      mode: options.mode,
      chatSessionId: options.chatSessionId,
      clientSituation: options.clientSituation,
      config,
      voiceConfig,
      apiKey,
    });
    await session.start();
    return session;
  }

  async closeSession(session: VoiceEngineSession): Promise<void> {
    session.onDisconnect();
  }
}
