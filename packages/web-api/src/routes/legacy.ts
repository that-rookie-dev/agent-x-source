import { Router } from 'express';
import type { ApiContext } from '../services/ApiService.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initChannelSessionBridge } from '../channel-session-bridge.js';
import { createFilesRouter } from './legacy/files.js';
import { createGatewayRouter } from './legacy/gateway.js';
import { createOrchestratorRouter } from './legacy/orchestrator.js';
import { createPermissionRouter } from './legacy/permission.js';
import { createPluginsRouter } from './legacy/plugins.js';
import { createSecretSauceRouter } from './legacy/secret-sauce.js';
import { createStaticRouter } from './legacy/static.js';
import { createSystemRouter } from './legacy/system.js';
import { createTodosRouter } from './legacy/todos.js';
import { createToolsRouter } from './legacy/tools.js';
import { createChannelsRouter } from './legacy/channels.js';
import { createProvidersRouter } from './legacy/providers.js';
import { createCrewsRouter } from './legacy/crews.js';
import { createAgentRouter } from './legacy/agent.js';
import { createAttachmentsRouter } from './legacy/attachments.js';
import { createChatRouter } from './legacy/chat.js';
import { createSettingsRouter } from './legacy/settings.js';
import { createSessionsRouter } from './legacy/sessions.js';
import { createSubagentsRouter } from './legacy/subagents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  r.use(createOrchestratorRouter());
  r.use(createPermissionRouter());
  r.use(createPluginsRouter());
  r.use(createSecretSauceRouter());
  r.use(createSystemRouter());
  r.use(createTodosRouter());
  r.use(createToolsRouter());
  r.use(createChannelsRouter());
  r.use(createProvidersRouter());
  r.use(createCrewsRouter());
  r.use(createAgentRouter());
  r.use(createAttachmentsRouter());
  r.use(createChatRouter());
  r.use(createSettingsRouter());
  r.use(createSessionsRouter());
  r.use(createSubagentsRouter(ctx));
  // ───── Static file serve (mounted last so it never shadows API routes) ─────
  r.use(createStaticRouter());
  return r;
}
