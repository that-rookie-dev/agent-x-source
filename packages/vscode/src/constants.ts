export const EXTENSION_ID = 'slashpan.agentx';
export const EXTENSION_DISPLAY_NAME = 'Agent-X';

export const COMMANDS = {
  OPEN_CHAT: 'agentx.openChat',
  NEW_SESSION: 'agentx.newSession',
  SWITCH_MODEL: 'agentx.switchModel',
  SWITCH_PROVIDER: 'agentx.switchProvider',
  SWITCH_CREW: 'agentx.switchCrew',
  CANCEL_TASK: 'agentx.cancelTask',
  SHOW_SESSIONS: 'agentx.showSessions',
  SHOW_PERMISSIONS: 'agentx.showPermissions',
  COMPACT_SESSION: 'agentx.compactSession',
  CLEAR_HISTORY: 'agentx.clearHistory',
  EXPORT_SESSION: 'agentx.exportSession',
  RESTORE_SESSION: 'agentx.restoreSession',
  DELETE_SESSION: 'agentx.deleteSession',
  REFRESH_SESSIONS: 'agentx.refreshSessions',
  OPEN_SETTINGS: 'agentx.openSettings',
  SHOW_TOKEN_USAGE: 'agentx.showTokenUsage',
  ADD_FILE_TO_CONTEXT: 'agentx.addFileToContext',
  ADD_SELECTION_TO_CONTEXT: 'agentx.addSelectionToContext',
  EXPLAIN_SELECTION: 'agentx.explainSelection',
  REFACTOR_SELECTION: 'agentx.refactorSelection',
  FIX_DIAGNOSTICS: 'agentx.fixDiagnostics',
  GENERATE_TESTS: 'agentx.generateTests',
  STEER_AGENT: 'agentx.steerAgent',
  APPROVE_PLAN: 'agentx.approvePlan',
  REJECT_PLAN: 'agentx.rejectPlan',
  OPEN_MISSION_CONTROL: 'agentx.openMissionControl',
} as const;

export const VIEWS = {
  CHAT: 'agentx.chatView',
  SESSIONS: 'agentx.sessionsView',
} as const;

export const VIEW_CONTAINERS = {
  EXPLORER: 'agentx-explorer',
} as const;

export const CONFIG_KEYS = {
  PROVIDER: 'agentx.provider',
  MODEL: 'agentx.model',
  THEME: 'agentx.theme',
  AUTO_APPROVE: 'agentx.autoApprove',
  SHOW_TOKEN_BAR: 'agentx.showTokenBar',
  SHOW_TIMERS: 'agentx.showTimers',
  ANIMATION_SPEED: 'agentx.animationSpeed',
  MAX_TOKENS_PER_SESSION: 'agentx.maxTokensPerSession',
  COMPACTION_THRESHOLD: 'agentx.compactionThreshold',
  ENABLE_SUB_AGENTS: 'agentx.enableSubAgents',
  ENABLE_PLANS: 'agentx.enablePlans',
  ENABLE_RAG: 'agentx.enableRAG',
  DISABLED_TOOLS: 'agentx.disabledTools',
  TELEMETRY: 'agentx.telemetry',
  LOG_LEVEL: 'agentx.logLevel',
} as const;

export const OUTPUT_CHANNEL_NAME = 'Agent-X';

export const STATUS_BAR_PRIORITY = 100;
