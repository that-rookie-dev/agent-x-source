import { Router } from 'express';
import type { ApiContext } from '../services/ApiService.js';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDataDir } from '@agentx/shared';
import { setDefaultEmbeddingCacheDir } from '@agentx/engine';
import { initChannelSessionBridge } from '../channel-session-bridge.js';
import { createFilesRouter } from './legacy/files.js';
import { createGatewayRouter } from './legacy/gateway.js';
import { createModeRouter } from './legacy/mode.js';
import { createOrchestratorRouter } from './legacy/orchestrator.js';
import { createPermissionRouter } from './legacy/permission.js';
import { createPluginsRouter } from './legacy/plugins.js';
import { createRagRouter } from './legacy/rag.js';
import { createSecretSauceRouter } from './legacy/secret-sauce.js';
import { createStaticRouter } from './legacy/static.js';
import { createSystemRouter } from './legacy/system.js';
import { createTodosRouter } from './legacy/todos.js';
import { createToolsRouter } from './legacy/tools.js';
import { createChannelsRouter } from './legacy/channels.js';
import { createProvidersRouter } from './legacy/providers.js';
import { createCrewsRouter } from './legacy/crews.js';
import { createAgentRouter } from './legacy/agent.js';
import { createChatRouter } from './legacy/chat.js';
import { createSettingsRouter } from './legacy/settings.js';
import { createSessionsRouter } from './legacy/sessions.js';
import { createSubagentsRouter } from './legacy/subagents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Embedding models are downloaded at runtime (during the setup wizard) to the
// user's data directory. The embedding-model-api router sets the cache dir via
// setDefaultEmbeddingCacheDir() on import. This bundled-dir fallback is kept
// for backward compatibility with existing installs that bundled the models.
const BUNDLED_EMBEDDING_MODEL_DIR = join(__dirname, 'models');
if (existsSync(join(BUNDLED_EMBEDDING_MODEL_DIR, 'Xenova', 'all-MiniLM-L6-v2')) ||
    existsSync(join(BUNDLED_EMBEDDING_MODEL_DIR, 'Xenova', 'bge-m3'))) {
  // Only use bundled dir if the runtime-downloaded models aren't present yet.
  const runtimeModelDir = join(getDataDir(), 'models');
  if (!existsSync(join(runtimeModelDir, 'Xenova', 'bge-m3')) &&
      !existsSync(join(runtimeModelDir, 'Xenova', 'all-MiniLM-L6-v2'))) {
    setDefaultEmbeddingCacheDir(BUNDLED_EMBEDDING_MODEL_DIR);
  }
}

export function router(ctx: ApiContext): Router {
  void ctx;
  // Wire the channel-to-session bridge once when the legacy API router is built.
  initChannelSessionBridge();
  const r = Router();
  // ───── Split router modules (extracted from this file) ─────
  // API route groups mounted first; first-match wins so these take precedence
  // over any legacy inline handlers for the same paths below.
  r.use(createFilesRouter());
  r.use(createGatewayRouter());
  r.use(createModeRouter());
  r.use(createOrchestratorRouter());
  r.use(createPermissionRouter());
  r.use(createPluginsRouter());
  r.use(createRagRouter());
  r.use(createSecretSauceRouter());
  r.use(createSystemRouter());
  r.use(createTodosRouter());
  r.use(createToolsRouter());
  r.use(createChannelsRouter());
  r.use(createProvidersRouter());
  r.use(createCrewsRouter());
  r.use(createAgentRouter());
  r.use(createChatRouter());
  r.use(createSettingsRouter());
  r.use(createSessionsRouter());
  r.use(createSubagentsRouter(ctx));
  // ───── Static file serve (mounted last so it never shadows API routes) ─────
  r.use(createStaticRouter());
  return r;
}
