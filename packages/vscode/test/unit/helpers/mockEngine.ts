import { vi } from 'vitest';
import type { MockEventEmitter } from '../__mocks__/vscode';

export function createMockAgent() {
  return {
    getStatus: vi.fn().mockReturnValue('ready'),
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue('response'),
    cancelProcessing: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4' }),
    getSessionId: vi.fn().mockReturnValue('session-1'),
    getWorkspaceRoot: vi.fn().mockReturnValue('/mock/workspace'),
    onStatusChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    setPlanMode: vi.fn(),
    respondToPlan: vi.fn(),
    respondToStep: vi.fn(),
    respondToClarification: vi.fn(),
    planModeEnabled: false,
    events: {
      on: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    sauce: {
      memory: { getRecentMemories: vi.fn().mockResolvedValue([]) },
      diary: { getRecent: vi.fn().mockResolvedValue([]) },
      soul: { getContent: vi.fn().mockResolvedValue('') },
      identity: { getState: vi.fn().mockResolvedValue({}) },
      crew: { getActiveId: vi.fn().mockReturnValue('default'), list: vi.fn().mockResolvedValue([]) },
    },
    isProcessing: vi.fn().mockReturnValue(false),
  };
}

export function createMockEventBridge() {
  return {
    onMessage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onStream: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onToolEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onPermission: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onError: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onPlanEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onSubAgentEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onReasoning: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onMeta: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onVisual: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onTokenUpdate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onTodo: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDiffPreview: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onIndexing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onResearch: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onLoading: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onProcessing: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onClarification: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onCompaction: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onWatchEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onBackgroundTask: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onReminder: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
  };
}

export function createMockConfigBridge() {
  return {
    getConfig: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4' }),
    isConfigured: vi.fn().mockReturnValue(true),
    onConfigChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    syncToEngine: vi.fn().mockResolvedValue(undefined),
    getWorkspaceRoot: vi.fn().mockReturnValue('/mock/workspace'),
    getActiveProvider: vi.fn().mockReturnValue('openai'),
    getActiveModel: vi.fn().mockReturnValue('gpt-4'),
    getActiveCrewName: vi.fn().mockReturnValue('default'),
    dispose: vi.fn(),
  };
}
