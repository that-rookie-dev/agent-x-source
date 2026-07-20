export const AgentRuntime = function MockAgentRuntime() {};
export const createServerRuntimeOptions = () => ({
  mode: 'server',
  isDev: false,
  port: 3333,
  getResourcesPath: () => '/resources',
  getDataDir: () => '/data',
  listenHost: '127.0.0.1',
});
export const createDesktopRuntimeOptions = () => ({
  mode: 'desktop',
  isDev: false,
  getResourcesPath: () => '/resources',
  getDataDir: () => '/data',
});
export const resolveRuntimePaths = () => ({
  webApiPath: '/web-api/index.js',
  webUiDir: '/web-ui',
  pythonPath: 'python3',
  pythonDir: '',
  ffmpegPath: 'ffmpeg',
  ffmpegDir: '',
  voiceSidecarDir: '/voice-sidecar',
  voiceBundleDir: '/voice-sidecar/bundled',
  voiceManifestPath: '/voice-sidecar/manifest.json',
});
export const resolvePublicUrl = () => 'http://localhost:3333';
