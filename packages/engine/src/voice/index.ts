export { VoiceSidecarClient } from './sidecar/VoiceSidecarClient.js';
export {
  DEFAULT_VOICE_CONFIG,
  VOICE_ASSET_CATALOG,
  addVoiceDownloadedAsset,
  isVoiceAssetInstalled,
  mergeVoiceConfig,
  recommendedVoiceComputeDevice,
} from './VoiceAssetCatalog.js';
export { VoiceAssetManager } from './VoiceAssetManager.js';
export type { VoiceAssetDownloadProgress, VoiceAssetManagerOptions } from './VoiceAssetManager.js';
export {
  bootstrapBundledVoiceAssets,
  getBundledAssetIds,
  getDefaultDownloadAssetIds,
  getManifestEntry,
  loadVoiceModelsManifest,
  registerAliasAssets,
  resolveVoiceBundleDir,
  resolveVoiceManifestPath,
} from './VoiceAssetManifest.js';
export type {
  VoiceAssetTier,
  VoiceModelManifestEntry,
  VoiceModelSource,
  VoiceModelsManifest,
} from './VoiceAssetManifest.js';
export { VoiceService } from './VoiceService.js';
export type { VoiceServiceOptions, VoiceSynthesizeOptions, VoiceTranscribeFileOptions, VoiceStreamSynthesizeResult } from './VoiceService.js';
export { VoiceSession } from './VoiceSession.js';
export type { VoiceSessionOptions, VoiceSessionState } from './VoiceSession.js';
export { VoiceProgressSession } from './VoiceProgressSession.js';
export type { VoiceProgressStage } from './VoiceProgressSession.js';
export { shouldSpeakVoiceAckFiller } from './voiceFillerPolicy.js';
export { FillerCache } from './FillerCache.js';
export { DEFAULT_FILLER_LINES } from './FillerCache.js';
export { normalizeTextForSpeech } from './speech/normalize.js';
export { cleanupVoiceTempDir, VOICE_LIMITS } from './audio/tempCleanup.js';
export {
  convertOggToWav16kMono,
  convertPcmToWav,
  convertWavToOggOpus,
  ensureFfmpegAvailable,
} from './audio/ffmpeg.js';
export type { FfmpegOptions } from './audio/ffmpeg.js';
export type { VoiceTransport, VoiceTransportAudioChunk, VoiceTransportEvents, VoiceTransportSessionMeta } from './transports/VoiceTransport.js';
export { WebSocketVoiceTransport } from './transports/WebSocketVoiceTransport.js';
export { TelegramVoiceNoteTransport } from './transports/TelegramVoiceNoteTransport.js';
export type { VoiceSidecarClientOptions } from './sidecar/VoiceSidecarClient.js';
export { VoiceSidecarManager } from './sidecar/VoiceSidecarManager.js';
export type { VoiceSidecarManagerOptions, VoiceSidecarStatus } from './sidecar/VoiceSidecarManager.js';
export { VoipVoiceTransport } from './transports/VoipVoiceTransport.js';
export type {
  VoiceSidecarCancelRequest,
  VoiceSidecarHealth,
  VoiceSidecarStreamAudioChunk,
  VoiceSidecarStreamSynthesizeRequest,
  VoiceSidecarStreamSynthesizeResponse,
  VoiceSidecarStreamTranscribeRequest,
  VoiceSidecarStreamTranscribeResponse,
  VoiceSidecarSynthesizeRequest,
  VoiceSidecarSynthesizeResponse,
  VoiceSidecarTranscribeRequest,
  VoiceSidecarTranscribeResponse,
  VoiceSidecarTranscriptSegment,
  VoiceSidecarVadDetectRequest,
  VoiceSidecarVadDetectResponse,
  VoiceSidecarWarmRequest,
} from './sidecar/VoiceSidecarProtocol.js';
