# Phase 11: Integration Testing, Packaging, CI/CD, and Marketplace Preparation

> **Status**: ⬜ Not Started
> **Depends on**: Phase 1–10 (all prior phases)
> **Estimated Effort**: 7–10 days
> **Files Created**: `packages/vscode/test/`, `packages/vscode/.vscodeignore`, `.github/workflows/vscode-release.yml`, `.github/workflows/vscode-pr.yml`, `packages/vscode/README.md`, `packages/vscode/CHANGELOG.md`, `packages/vscode/LICENSE`

---

## Overview

Phase 11 is the final phase of the Agent-X VS Code extension project. It covers comprehensive testing (unit, integration, webview), native dependency handling, VSIX packaging, CI/CD pipeline setup, marketplace preparation, performance optimization, accessibility audit, security review, and cross-platform verification. By the end of this phase, the extension will be production-ready, packaged, and publishable to both the VS Code Marketplace and Open VSX Registry.

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Testing & Packaging Layer                     │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Unit Tests   │  │ Integration  │  │  Webview Tests           │  │
│  │  (vitest)     │  │ Tests        │  │  (@testing-library/react)│  │
│  │              │  │ (@vscode/    │  │                          │  │
│  │  Mock vscode │  │  test-electron)│  │  jsdom environment      │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                  │                       │                │
│  ┌──────▼──────────────────▼───────────────────────▼─────────────┐  │
│  │                    Test Infrastructure                        │  │
│  │  vitest.config.ts · test/suite/index.ts · test helpers        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  VSIX Build   │  │  CI/CD       │  │  Marketplace             │  │
│  │  esbuild      │  │  GitHub      │  │  vsce publish            │  │
│  │  vsce package │  │  Actions     │  │  ovsx publish            │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **vitest for unit tests** — Faster than mocha, native ESM support, built-in mocking, compatible with the existing `@agentx/engine` test infrastructure.
2. **@vscode/test-electron for integration tests** — Official VS Code test runner that launches a real VS Code instance with the extension loaded.
3. **@testing-library/react for webview tests** — Industry-standard React testing that runs in jsdom, no browser needed.
4. **Option C for native dependencies** — Use `VSCodeStorageAdapter` (JSON-file based, implemented in Phase 2) instead of `better-sqlite3` in the VS Code context. This eliminates all native binary concerns.
5. **Dual marketplace publishing** — Both VS Code Marketplace (`vsce`) and Open VSX Registry (`ovsx`) for maximum reach.

---

## Task Index

| Task ID | Title | Status | Priority |
|---------|-------|--------|----------|
| T11.1 | Unit Test Suite | ⬜ | Core |
| T11.2 | Integration Test Suite | ⬜ | Core |
| T11.3 | Webview Tests | ⬜ | Core |
| T11.4 | Native Dependency Handling | ⬜ | Core |
| T11.5 | VSIX Packaging | ⬜ | Core |
| T11.6 | Extension Manifest Polish | ⬜ | P1 |
| T11.7 | CI/CD Pipeline | ⬜ | Core |
| T11.8 | Marketplace Preparation | ⬜ | P1 |
| T11.9 | Performance Optimization | ⬜ | P1 |
| T11.10 | Accessibility | ⬜ | P1 |
| T11.11 | Security Review | ⬜ | Core |
| T11.12 | Final Verification | ⬜ | Core |

---

## T11.1: Unit Test Suite

**Status**: ⬜ Not Started
**Directory**: `packages/vscode/test/unit/`
**Estimated Effort**: 3 days

### T11.1.1: Test Infrastructure Setup

**File**: `packages/vscode/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    exclude: ['test/suite/**', 'test/webview/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/webview/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    setupFiles: ['test/unit/setup.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/unit/__mocks__/vscode.ts'),
      '@agentx/engine': path.resolve(__dirname, '../engine/src/index.ts'),
      '@agentx/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
```

**File**: `packages/vscode/test/unit/setup.ts`

```typescript
import { vi } from 'vitest';

vi.mock('vscode', () => {
  return require('./__mocks__/vscode');
});

process.env.NODE_ENV = 'test';
process.env.AGENTX_TEST = '1';
```

**File**: `packages/vscode/test/unit/__mocks__/vscode.ts`

```typescript
import { vi } from 'vitest';

class MockEventEmitter {
  private listeners: Array<(...args: unknown[]) => void> = [];

  event = (listener: (...args: unknown[]) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };

  fire(data?: unknown) {
    this.listeners.forEach(l => l(data));
  }

  dispose() {
    this.listeners = [];
  }
}

class MockTreeItem {
  label: string;
  collapsibleState: number;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState ?? 0;
  }
}

class MockUri {
  static file(path: string) { return { scheme: 'file', fsPath: path, path }; }
  static parse(str: string) { return { scheme: 'https', path: str }; }
  static joinPath(base: { fsPath: string }, ...segments: string[]) {
    return MockUri.file([base.fsPath, ...segments].join('/'));
  }
  scheme = 'file';
  fsPath = '';
  path = '';
  toString() { return this.path; }
}

class MockThemeIcon {
  constructor(public readonly id: string, public readonly color?: unknown) {}
}

class MockThemeColor {
  constructor(public readonly id: string) {}
}

class MockCancellationTokenSource {
  token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
}

class MockDisposable {
  private callback?: () => void;
  constructor(callback?: () => void) { this.callback = callback; }
  dispose() { this.callback?.(); }
}

const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
const TreeItemCheckboxState = { Unchecked: 0, Checked: 1 };
const StatusBarAlignment = { Left: 1, Right: 2 };
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 };
const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 };

const workspace = {
  workspaceFolders: [{ uri: MockUri.file('/mock/workspace'), name: 'mock', index: 0 }],
  getConfiguration: vi.fn(() => ({
    get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
    update: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockReturnValue(false),
    inspect: vi.fn().mockReturnValue({ globalValue: undefined, workspaceValue: undefined }),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  fs: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ type: 1, size: 0 }),
    readDirectory: vi.fn().mockResolvedValue([]),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  },
  createFileSystemWatcher: vi.fn(() => ({
    onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  })),
  asRelativePath: vi.fn((path: string) => path),
  findFiles: vi.fn().mockResolvedValue([]),
  textDocuments: [],
  onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  openTextDocument: vi.fn().mockResolvedValue({
    getText: vi.fn().mockReturnValue(''),
    lineCount: 0,
    uri: MockUri.file('/mock/file.ts'),
  }),
};

const window = {
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showQuickPick: vi.fn().mockResolvedValue(undefined),
  showInputBox: vi.fn().mockResolvedValue(undefined),
  showOpenDialog: vi.fn().mockResolvedValue(undefined),
  showSaveDialog: vi.fn().mockResolvedValue(undefined),
  showTextDocument: vi.fn().mockResolvedValue(undefined),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  })),
  createStatusBarItem: vi.fn(() => ({
    text: '',
    tooltip: '',
    command: '',
    color: '',
    backgroundColor: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  createTreeView: vi.fn(() => ({
    reveal: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCollapseElement: vi.fn(() => ({ dispose: vi.fn() })),
    onDidExpandElement: vi.fn(() => ({ dispose: vi.fn() })),
  })),
  createWebviewPanel: vi.fn(() => ({
    webview: {
      html: '',
      options: {},
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      postMessage: vi.fn().mockResolvedValue(true),
      asWebviewUri: vi.fn((uri: { fsPath: string }) => uri),
      cspSource: 'https://mock.csp',
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
    reveal: vi.fn(),
    dispose: vi.fn(),
    visible: true,
    active: true,
  })),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  withProgress: vi.fn((_opts: unknown, task: (progress: unknown) => Promise<unknown>) => {
    return task({ report: vi.fn() });
  }),
  activeTextEditor: undefined,
  visibleTextEditors: [],
  onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: vi.fn() })),
  activeColorTheme: { kind: ColorThemeKind.Dark },
  onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
  createTerminal: vi.fn(() => ({
    sendText: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  tabGroups: { all: [] },
};

const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn().mockResolvedValue(undefined),
  getCommands: vi.fn().mockResolvedValue([]),
};

const env = {
  clipboard: {
    readText: vi.fn().mockResolvedValue(''),
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  openExternal: vi.fn().mockResolvedValue(true),
  machineId: 'test-machine-id',
  sessionId: 'test-session-id',
  appName: 'Visual Studio Code',
  appHost: 'desktop',
  uriScheme: 'vscode',
  language: 'en',
};

const extensions = {
  getExtension: vi.fn().mockReturnValue(undefined),
  all: [],
};

const languages = {
  createDiagnosticCollection: vi.fn(() => ({
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  })),
  registerCodeActionsProvider: vi.fn(() => ({ dispose: vi.fn() })),
};

const debug = {
  registerDebugConfigurationProvider: vi.fn(() => ({ dispose: vi.fn() })),
};

const tasks = {
  registerTaskProvider: vi.fn(() => ({ dispose: vi.fn() })),
};

export {
  MockEventEmitter as EventEmitter,
  MockTreeItem as TreeItem,
  MockUri as Uri,
  MockThemeIcon as ThemeIcon,
  MockThemeColor as ThemeColor,
  MockCancellationTokenSource as CancellationTokenSource,
  MockDisposable as Disposable,
  TreeItemCollapsibleState,
  TreeItemCheckboxState,
  StatusBarAlignment,
  ConfigurationTarget,
  ViewColumn,
  ProgressLocation,
  DiagnosticSeverity,
  ColorThemeKind,
  workspace,
  window,
  commands,
  env,
  extensions,
  languages,
  debug,
  tasks,
};
```

**File**: `packages/vscode/test/unit/helpers/mockEngine.ts`

```typescript
import { vi } from 'vitest';

export function createMockAgent() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ id: 'msg-1', content: 'mock response' }),
    respondToPermission: vi.fn().mockResolvedValue(undefined),
    respondToClarification: vi.fn().mockResolvedValue(undefined),
    switchProvider: vi.fn().mockResolvedValue(undefined),
    switchModel: vi.fn().mockResolvedValue(undefined),
    listModels: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockReturnValue({ id: 'session-1', title: 'Test Session' }),
    getSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: 'session-new' }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn().mockResolvedValue(undefined),
    getSecretSauce: vi.fn().mockReturnValue({
      memory: { getRecentMemories: vi.fn().mockResolvedValue([]) },
      diary: { getRecent: vi.fn().mockResolvedValue([]) },
      soul: { getContent: vi.fn().mockResolvedValue('') },
      identity: { getState: vi.fn().mockResolvedValue({}) },
      crew: { getActiveId: vi.fn().mockReturnValue('default'), list: vi.fn().mockResolvedValue([]) },
    }),
    getConfig: vi.fn().mockReturnValue({
      provider: 'openai',
      model: 'gpt-4',
    }),
    getToolkit: vi.fn().mockReturnValue({
      getDefinitions: vi.fn().mockReturnValue([]),
    }),
    getEventBus: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
    isProcessing: vi.fn().mockReturnValue(false),
    getStatus: vi.fn().mockReturnValue('ready'),
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
    isFirstRun: vi.fn().mockReturnValue(false),
    isConfigured: vi.fn().mockReturnValue(true),
    onConfigChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    syncToEngine: vi.fn().mockResolvedValue(undefined),
    getWorkspaceRoot: vi.fn().mockReturnValue('/mock/workspace'),
    dispose: vi.fn(),
  };
}

export function createMockExtensionContext() {
  const storage = new Map<string, unknown>();
  const globalStorage = new Map<string, unknown>();

  return {
    subscriptions: [],
    extensionUri: { scheme: 'file', fsPath: '/mock/extension', path: '/mock/extension' },
    extensionPath: '/mock/extension',
    globalStorageUri: { scheme: 'file', fsPath: '/mock/global-storage', path: '/mock/global-storage' },
    storageUri: { scheme: 'file', fsPath: '/mock/storage', path: '/mock/storage' },
    logUri: { scheme: 'file', fsPath: '/mock/log', path: '/mock/log' },
    extensionMode: 1,
    workspaceState: {
      get: vi.fn((key: string) => storage.get(key)),
      update: vi.fn((key: string, value: unknown) => { storage.set(key, value); return Promise.resolve(); }),
      keys: vi.fn(() => [...storage.keys()]),
    },
    globalState: {
      get: vi.fn((key: string) => globalStorage.get(key)),
      update: vi.fn((key: string, value: unknown) => { globalStorage.set(key, value); return Promise.resolve(); }),
      keys: vi.fn(() => [...globalStorage.keys()]),
      setKeysForSync: vi.fn(),
    },
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    },
    asAbsolutePath: vi.fn((relativePath: string) => `/mock/extension/${relativePath}`),
  };
}
```

---

### T11.1.2: VSCodeEngine Unit Tests

**File**: `packages/vscode/test/unit/adapter/VSCodeEngine.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VSCodeEngine } from '../../../src/adapter/VSCodeEngine';
import { createMockAgent, createMockExtensionContext } from '../helpers/mockEngine';

vi.mock('@agentx/engine', () => ({
  Agent: vi.fn().mockImplementation(() => createMockAgent()),
  ConfigManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4' }),
    getConfigPath: vi.fn().mockReturnValue('/mock/config.json'),
  })),
  createDefaultToolkit: vi.fn().mockReturnValue({
    getDefinitions: vi.fn().mockReturnValue([]),
    executor: { registerHandler: vi.fn() },
  }),
}));

describe('VSCodeEngine', () => {
  let engine: VSCodeEngine;
  let context: ReturnType<typeof createMockExtensionContext>;

  beforeEach(() => {
    context = createMockExtensionContext();
    engine = new VSCodeEngine({
      workspaceRoot: '/mock/workspace',
      context: context as any,
      autoInitialize: false,
    });
  });

  afterEach(() => {
    engine.dispose();
  });

  it('should initialize with uninitialized status', () => {
    expect(engine.getStatus()).toBe('uninitialized');
    expect(engine.getWorkspaceRoot()).toBe('/mock/workspace');
    expect(engine.getSessionId()).toBeNull();
  });

  it('should transition to initializing then ready on initialize()', async () => {
    const statuses: string[] = [];
    engine.onStatusChange((status) => statuses.push(status));

    await engine.initialize();

    expect(statuses).toContain('initializing');
    expect(statuses).toContain('ready');
    expect(engine.getStatus()).toBe('ready');
  });

  it('should set sessionId after initialization', async () => {
    await engine.initialize();
    expect(engine.getSessionId()).toBeDefined();
    expect(typeof engine.getSessionId()).toBe('string');
  });

  it('should emit lifecycle events during initialization', async () => {
    const events: any[] = [];
    engine.onLifecycle((event) => events.push(event));

    await engine.initialize();

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe('initializing');
    expect(events[events.length - 1].type).toBe('ready');
  });

  it('should handle workspace root changes', async () => {
    await engine.initialize();
    engine.setWorkspaceRoot('/new/workspace');
    expect(engine.getWorkspaceRoot()).toBe('/new/workspace');
  });

  it('should dispose cleanly', async () => {
    await engine.initialize();
    engine.dispose();
    expect(engine.getStatus()).toBe('disposed');
  });

  it('should support restart', async () => {
    await engine.initialize();
    const firstSessionId = engine.getSessionId();

    await engine.restart();

    expect(engine.getStatus()).toBe('ready');
    expect(engine.getSessionId()).toBeDefined();
  });

  it('should throw if sendMessage called before initialization', async () => {
    await expect(engine.sendMessage('hello')).rejects.toThrow();
  });

  it('should forward sendMessage to underlying agent', async () => {
    await engine.initialize();
    const result = await engine.sendMessage('hello');
    expect(result).toBeDefined();
  });

  it('should track processing state', async () => {
    await engine.initialize();
    expect(engine.isProcessing()).toBe(false);
  });
});
```

---

### T11.1.3: EventBridge Unit Tests

**File**: `packages/vscode/test/unit/adapter/EventBridge.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBridge } from '../../../src/adapter/EventBridge';
import { createMockAgent } from '../helpers/mockEngine';

describe('EventBridge', () => {
  let bridge: EventBridge;
  let mockAgent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    mockAgent = createMockAgent();
    bridge = new EventBridge(mockAgent as any);
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('should register message callback', () => {
    const callback = vi.fn();
    const disposable = bridge.onMessage(callback);
    expect(disposable).toBeDefined();
    expect(typeof disposable.dispose).toBe('function');
  });

  it('should register stream callback', () => {
    const callback = vi.fn();
    const disposable = bridge.onStream(callback);
    expect(disposable).toBeDefined();
  });

  it('should register tool event callback', () => {
    const callback = vi.fn();
    const disposable = bridge.onToolEvent(callback);
    expect(disposable).toBeDefined();
  });

  it('should register permission callback', () => {
    const callback = vi.fn();
    const disposable = bridge.onPermission(callback);
    expect(disposable).toBeDefined();
  });

  it('should register error callback', () => {
    const callback = vi.fn();
    const disposable = bridge.onError(callback);
    expect(disposable).toBeDefined();
  });

  it('should throttle stream events to 16ms intervals', async () => {
    const callback = vi.fn();
    bridge.onStream(callback);

    const rapidFire = Array.from({ length: 100 }, (_, i) => ({
      content: `chunk-${i}`,
      fullContent: `full-${i}`,
    }));

    for (const chunk of rapidFire) {
      bridge.emitStream(chunk);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(callback.mock.calls.length).toBeLessThan(rapidFire.length);
    expect(callback.mock.calls.length).toBeGreaterThan(0);
  });

  it('should dispose all listeners on bridge disposal', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bridge.onMessage(cb1);
    bridge.onStream(cb2);

    bridge.dispose();

    expect(() => bridge.emitStream({ content: 'test', fullContent: 'test' })).not.toThrow();
  });

  it('should support removing individual listeners', () => {
    const callback = vi.fn();
    const disposable = bridge.onMessage(callback);

    disposable.dispose();

    bridge.emitMessage({
      id: '1', sessionId: 's1', role: 'assistant',
      content: 'test', toolCalls: null, tokenCount: 0, createdAt: '',
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('should map all engine event types correctly', () => {
    const handlers = [
      'onMessage', 'onStream', 'onToolEvent', 'onPermission', 'onError',
      'onPlanEvent', 'onSubAgentEvent', 'onReasoning', 'onMeta', 'onVisual',
      'onTokenUpdate', 'onTodo', 'onDiffPreview', 'onIndexing', 'onResearch',
      'onLoading', 'onProcessing', 'onClarification', 'onCompaction',
      'onWatchEvent', 'onBackgroundTask', 'onReminder',
    ];

    for (const handler of handlers) {
      expect(typeof (bridge as any)[handler]).toBe('function');
    }
  });

  it('should not emit after disposal', () => {
    const callback = vi.fn();
    bridge.onMessage(callback);
    bridge.dispose();

    bridge.emitMessage({
      id: '1', sessionId: 's1', role: 'assistant',
      content: 'test', toolCalls: null, tokenCount: 0, createdAt: '',
    });
    expect(callback).not.toHaveBeenCalled();
  });
});
```

---

### T11.1.4: ConfigBridge Unit Tests

**File**: `packages/vscode/test/unit/adapter/ConfigBridge.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigBridge } from '../../../src/adapter/ConfigBridge';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({
    provider: 'openai',
    model: 'gpt-4',
    setupComplete: true,
  })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('ConfigBridge', () => {
  let bridge: ConfigBridge;

  beforeEach(() => {
    bridge = new ConfigBridge();
    vi.clearAllMocks();
  });

  it('should initialize and load config', async () => {
    await bridge.initialize();
    expect(bridge.isConfigured()).toBe(true);
  });

  it('should detect first run when no config exists', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));

    await bridge.initialize();
    expect(bridge.isFirstRun()).toBe(true);
  });

  it('should return config object after initialization', async () => {
    await bridge.initialize();
    const config = bridge.getConfig();
    expect(config).toBeDefined();
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-4');
  });

  it('should fire config change events', async () => {
    await bridge.initialize();
    const callback = vi.fn();
    bridge.onConfigChanged(callback);

    await bridge.syncToEngine({ provider: 'anthropic', model: 'claude-3-opus' });
    expect(callback).toHaveBeenCalled();
  });

  it('should sync provider changes to engine config', async () => {
    await bridge.initialize();
    await bridge.syncToEngine({ provider: 'anthropic' });
    const config = bridge.getConfig();
    expect(config.provider).toBe('anthropic');
  });

  it('should sync model changes to engine config', async () => {
    await bridge.initialize();
    await bridge.syncToEngine({ model: 'gpt-4-turbo' });
    const config = bridge.getConfig();
    expect(config.model).toBe('gpt-4-turbo');
  });

  it('should return workspace root', async () => {
    await bridge.initialize();
    expect(bridge.getWorkspaceRoot()).toBeDefined();
  });

  it('should dispose cleanly', async () => {
    await bridge.initialize();
    expect(() => bridge.dispose()).not.toThrow();
  });

  it('should handle corrupt config file gracefully', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockResolvedValueOnce('not valid json{{{');

    await bridge.initialize();
    expect(bridge.isConfigured()).toBe(false);
  });

  it('should preserve unknown config keys during sync', async () => {
    await bridge.initialize();
    await bridge.syncToEngine({ provider: 'google', customKey: 'value' } as any);
    const config = bridge.getConfig();
    expect((config as any).customKey).toBe('value');
  });
});
```

---

### T11.1.5: PermissionHandler Unit Tests

**File**: `packages/vscode/test/unit/adapter/PermissionHandler.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionHandler } from '../../../src/adapter/PermissionHandler';
import { createMockEventBridge, createMockAgent } from '../helpers/mockEngine';

describe('PermissionHandler', () => {
  let handler: PermissionHandler;
  let eventBridge: ReturnType<typeof createMockEventBridge>;
  let agent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    eventBridge = createMockEventBridge();
    agent = createMockAgent();
    handler = new PermissionHandler(eventBridge as any, agent as any, {
      autoApproveLowRisk: true,
      autoApproveMediumRisk: false,
      timeoutMs: 30000,
      defaultDecision: 'deny',
    });
  });

  afterEach(() => {
    handler.dispose();
  });

  it('should auto-approve low-risk tools when configured', async () => {
    const request = {
      tool: 'read_file',
      path: '/mock/workspace/src/index.ts',
      riskLevel: 'low',
      timestamp: Date.now(),
    };

    const result = await handler.resolve(request);
    expect(result).toBe('allow_once');
    expect(agent.respondToPermission).toHaveBeenCalledWith('allow_once');
  });

  it('should not auto-approve medium-risk tools by default', async () => {
    const request = {
      tool: 'write_file',
      path: '/mock/workspace/src/index.ts',
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const { window } = await import('vscode');
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce('Allow');

    await handler.resolve(request);
    expect(window.showWarningMessage).toHaveBeenCalled();
  });

  it('should show error modal for high-risk tools', async () => {
    const request = {
      tool: 'shell_exec',
      path: '/mock/workspace',
      riskLevel: 'high',
      timestamp: Date.now(),
    };

    const { window } = await import('vscode');
    vi.mocked(window.showErrorMessage).mockResolvedValueOnce('Allow Once');

    await handler.resolve(request);
    expect(window.showErrorMessage).toHaveBeenCalled();
  });

  it('should timeout and deny after configured duration', async () => {
    handler = new PermissionHandler(eventBridge as any, agent as any, {
      autoApproveLowRisk: false,
      autoApproveMediumRisk: false,
      timeoutMs: 100,
      defaultDecision: 'deny',
    });

    const request = {
      tool: 'write_file',
      path: '/mock/workspace/test.ts',
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const { window } = await import('vscode');
    vi.mocked(window.showWarningMessage).mockImplementation(
      () => new Promise(() => {})
    );

    const result = await handler.resolve(request);
    expect(result).toBe('deny');
  });

  it('should handle allow_always decision', async () => {
    const request = {
      tool: 'write_file',
      path: '/mock/workspace/src/index.ts',
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const { window } = await import('vscode');
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce('Allow Always');

    const result = await handler.resolve(request);
    expect(result).toBe('allow_always');
  });

  it('should handle deny decision from user', async () => {
    const request = {
      tool: 'write_file',
      path: '/mock/workspace/src/index.ts',
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const { window } = await import('vscode');
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce('Deny');

    const result = await handler.resolve(request);
    expect(result).toBe('deny');
  });

  it('should handle user dismissing the modal', async () => {
    const request = {
      tool: 'write_file',
      path: '/mock/workspace/src/index.ts',
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const { window } = await import('vscode');
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(undefined);

    const result = await handler.resolve(request);
    expect(result).toBe('deny');
  });

  it('should queue multiple permission requests sequentially', async () => {
    const requests = [
      { tool: 'write_file', path: '/a.ts', riskLevel: 'low', timestamp: Date.now() },
      { tool: 'write_file', path: '/b.ts', riskLevel: 'low', timestamp: Date.now() },
    ];

    const results = await Promise.all(requests.map(r => handler.resolve(r)));
    expect(results).toHaveLength(2);
    expect(results.every(r => r === 'allow_once')).toBe(true);
  });

  it('should dispose cleanly without pending requests', () => {
    expect(() => handler.dispose()).not.toThrow();
  });

  it('should cancel pending requests on disposal', async () => {
    const { window } = await import('vscode');
    vi.mocked(window.showWarningMessage).mockImplementation(
      () => new Promise(() => {})
    );

    const request = {
      tool: 'write_file',
      path: '/mock/workspace/test.ts',
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const promise = handler.resolve(request);
    handler.dispose();

    const result = await promise;
    expect(result).toBe('deny');
  });
});
```

---

### T11.1.6: ScopeGuardAdapter Unit Tests

**File**: `packages/vscode/test/unit/adapter/ScopeGuardAdapter.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScopeGuardAdapter } from '../../../src/adapter/ScopeGuardAdapter';

describe('ScopeGuardAdapter', () => {
  let adapter: ScopeGuardAdapter;

  beforeEach(() => {
    adapter = new ScopeGuardAdapter('/mock/workspace');
  });

  it('should accept paths within workspace root', () => {
    expect(adapter.validate('/mock/workspace/src/index.ts')).toBe(true);
    expect(adapter.validate('/mock/workspace/README.md')).toBe(true);
    expect(adapter.validate('/mock/workspace/deep/nested/file.ts')).toBe(true);
  });

  it('should reject paths outside workspace root', () => {
    expect(adapter.validate('/etc/passwd')).toBe(false);
    expect(adapter.validate('/home/user/.ssh/id_rsa')).toBe(false);
    expect(adapter.validate('/mock/other-project/file.ts')).toBe(false);
  });

  it('should reject path traversal attacks', () => {
    expect(adapter.validate('/mock/workspace/../../../etc/passwd')).toBe(false);
    expect(adapter.validate('/mock/workspace/../../other/file.ts')).toBe(false);
  });

  it('should handle symlink escape prevention', () => {
    const result = adapter.validateWithSymlinks('/mock/workspace/symlink-to-etc');
    expect(typeof result).toBe('object');
    expect(typeof result.valid).toBe('boolean');
  });

  it('should support multi-root workspaces', () => {
    adapter.setWorkspaceRoots(['/mock/workspace-a', '/mock/workspace-b']);
    expect(adapter.validate('/mock/workspace-a/file.ts')).toBe(true);
    expect(adapter.validate('/mock/workspace-b/file.ts')).toBe(true);
    expect(adapter.validate('/mock/workspace-c/file.ts')).toBe(false);
  });

  it('should block known dangerous paths', () => {
    expect(adapter.validate('/mock/workspace/.git/config')).toBe(false);
    expect(adapter.validate('/mock/workspace/.env')).toBe(false);
    expect(adapter.validate('/mock/workspace/node_modules/.bin/malicious')).toBe(false);
  });

  it('should normalize paths before validation', () => {
    expect(adapter.validate('/mock/workspace/./src/../src/index.ts')).toBe(true);
    expect(adapter.validate('/mock/workspace//src///index.ts')).toBe(true);
  });

  it('should emit notification events for blocked paths', () => {
    const callback = vi.fn();
    adapter.onBlocked(callback);

    adapter.validate('/etc/passwd');
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/etc/passwd',
        reason: expect.any(String),
      })
    );
  });

  it('should return workspace root', () => {
    expect(adapter.getWorkspaceRoot()).toBe('/mock/workspace');
  });

  it('should update workspace root dynamically', () => {
    adapter.setWorkspaceRoot('/new/workspace');
    expect(adapter.getWorkspaceRoot()).toBe('/new/workspace');
    expect(adapter.validate('/new/workspace/file.ts')).toBe(true);
    expect(adapter.validate('/mock/workspace/file.ts')).toBe(false);
  });
});
```

---

### T11.1.7: SessionLifecycle Unit Tests

**File**: `packages/vscode/test/unit/adapter/SessionLifecycle.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionLifecycle } from '../../../src/adapter/SessionLifecycle';
import {
  createMockAgent,
  createMockEventBridge,
  createMockConfigBridge,
} from '../helpers/mockEngine';

describe('SessionLifecycle', () => {
  let lifecycle: SessionLifecycle;
  let agent: ReturnType<typeof createMockAgent>;
  let eventBridge: ReturnType<typeof createMockEventBridge>;
  let configBridge: ReturnType<typeof createMockConfigBridge>;

  beforeEach(() => {
    agent = createMockAgent();
    eventBridge = createMockEventBridge();
    configBridge = createMockConfigBridge();
    lifecycle = new SessionLifecycle(agent as any, eventBridge as any, configBridge as any);
  });

  it('should create a new session', async () => {
    const session = await lifecycle.create('Test Session');
    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(agent.createSession).toHaveBeenCalled();
  });

  it('should restore an existing session by ID', async () => {
    await lifecycle.restore('session-123');
    expect(agent.restoreSession).toHaveBeenCalledWith('session-123');
  });

  it('should delete a session by ID', async () => {
    await lifecycle.delete('session-123');
    expect(agent.deleteSession).toHaveBeenCalledWith('session-123');
  });

  it('should emit lifecycle events on create', async () => {
    const callback = vi.fn();
    lifecycle.onSessionChange(callback);

    await lifecycle.create('Test');
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'created' })
    );
  });

  it('should emit lifecycle events on restore', async () => {
    const callback = vi.fn();
    lifecycle.onSessionChange(callback);

    await lifecycle.restore('session-123');
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'restored' })
    );
  });

  it('should emit lifecycle events on delete', async () => {
    const callback = vi.fn();
    lifecycle.onSessionChange(callback);

    await lifecycle.delete('session-123');
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'deleted', sessionId: 'session-123' })
    );
  });

  it('should return current session info', async () => {
    await lifecycle.create('Test');
    const current = lifecycle.getCurrentSession();
    expect(current).toBeDefined();
  });

  it('should list all sessions', async () => {
    agent.getSessions.mockResolvedValueOnce([
      { id: 's1', title: 'Session 1' },
      { id: 's2', title: 'Session 2' },
    ]);

    const sessions = await lifecycle.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it('should handle create failure gracefully', async () => {
    agent.createSession.mockRejectedValueOnce(new Error('Engine error'));
    await expect(lifecycle.create('Test')).rejects.toThrow('Engine error');
  });

  it('should handle restore of non-existent session', async () => {
    agent.restoreSession.mockRejectedValueOnce(new Error('Session not found'));
    await expect(lifecycle.restore('non-existent')).rejects.toThrow('Session not found');
  });
});
```

---

### T11.1.8: SessionPersistence Unit Tests

**File**: `packages/vscode/test/unit/adapter/SessionPersistence.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionPersistence } from '../../../src/adapter/SessionPersistence';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
}));

describe('SessionPersistence', () => {
  let persistence: SessionPersistence;
  const baseDir = '/mock/data/sessions';

  beforeEach(() => {
    persistence = new SessionPersistence(baseDir);
    vi.clearAllMocks();
  });

  it('should save a session atomically', async () => {
    const session = { id: 's1', title: 'Test', messages: [] };
    await persistence.saveSession(session);

    const fs = await import('node:fs/promises');
    expect(fs.writeFile).toHaveBeenCalled();
    expect(fs.rename).toHaveBeenCalled();
  });

  it('should load a session by ID', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify({ id: 's1', title: 'Test', messages: [] })
    );

    const session = await persistence.loadSession('s1');
    expect(session).toBeDefined();
    expect(session.id).toBe('s1');
  });

  it('should persist messages for a session', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'm2', role: 'assistant', content: 'hi there' },
    ];

    await persistence.saveMessages('s1', messages as any);

    const fs = await import('node:fs/promises');
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should load messages for a session', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify([{ id: 'm1', role: 'user', content: 'hello' }])
    );

    const messages = await persistence.loadMessages('s1');
    expect(messages).toHaveLength(1);
  });

  it('should delete a session and its files', async () => {
    await persistence.deleteSession('s1');

    const fs = await import('node:fs/promises');
    expect(fs.unlink).toHaveBeenCalled();
  });

  it('should list all persisted session IDs', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readdir).mockResolvedValueOnce(['s1', 's2', 's3'] as any);

    const ids = await persistence.listSessionIds();
    expect(ids).toEqual(['s1', 's2', 's3']);
  });

  it('should handle corrupted session files gracefully', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockResolvedValueOnce('not json{{{');

    await expect(persistence.loadSession('s1')).rejects.toThrow();
  });

  it('should create session directory if it does not exist', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'));

    await persistence.saveSession({ id: 's1', title: 'Test', messages: [] } as any);
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('s1'),
      { recursive: true }
    );
  });

  it('should use atomic write pattern (write to temp, rename)', async () => {
    await persistence.saveSession({ id: 's1', title: 'Test', messages: [] } as any);

    const fs = await import('node:fs/promises');
    const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
    const renameCall = vi.mocked(fs.rename).mock.calls[0];

    expect(writeCall[0]).toMatch(/\.tmp$/);
    expect(renameCall[0]).toMatch(/\.tmp$/);
    expect(renameCall[1]).not.toMatch(/\.tmp$/);
  });

  it('should persist token logs', async () => {
    const tokenLog = { inputTokens: 100, outputTokens: 50, cost: 0.01 };
    await persistence.saveTokenLog('s1', tokenLog);

    const fs = await import('node:fs/promises');
    expect(fs.writeFile).toHaveBeenCalled();
  });
});
```

---

### T11.1.9: ToolAdapterManager Unit Tests

**File**: `packages/vscode/test/unit/adapter/ToolAdapterManager.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolAdapterManager } from '../../../src/adapter/tools/ToolAdapterManager';

describe('ToolAdapterManager', () => {
  let manager: ToolAdapterManager;

  beforeEach(() => {
    manager = new ToolAdapterManager('/mock/workspace');
  });

  it('should initialize with default toolkit', () => {
    const definitions = manager.getDefinitions();
    expect(definitions).toBeDefined();
    expect(Array.isArray(definitions)).toBe(true);
  });

  it('should register a custom tool handler override', () => {
    const handler = vi.fn().mockResolvedValue({ success: true, output: 'custom' });
    manager.registerOverride('read_file', handler);

    expect(manager.hasOverride('read_file')).toBe(true);
  });

  it('should dispatch to overridden handler when tool is called', async () => {
    const handler = vi.fn().mockResolvedValue({ success: true, output: 'custom' });
    manager.registerOverride('read_file', handler);

    const result = await manager.execute('read_file', { path: '/test' }, {} as any);
    expect(handler).toHaveBeenCalledWith({ path: '/test' }, expect.anything());
    expect(result.success).toBe(true);
  });

  it('should dispatch to default handler when no override exists', async () => {
    const result = await manager.execute('some_default_tool', {}, {} as any);
    expect(result).toBeDefined();
  });

  it('should disable a tool with a stub handler', () => {
    manager.disableTool('browser_navigate');
    expect(manager.isDisabled('browser_navigate')).toBe(true);
  });

  it('should return friendly message for disabled tools', async () => {
    manager.disableTool('browser_navigate');
    const result = await manager.execute('browser_navigate', {}, {} as any);
    expect(result.success).toBe(false);
    expect(result.output).toContain('not available');
  });

  it('should batch-register multiple overrides', () => {
    const overrides = new Map([
      ['read_file', vi.fn().mockResolvedValue({ success: true, output: 'a' })],
      ['write_file', vi.fn().mockResolvedValue({ success: true, output: 'b' })],
    ]);

    manager.registerOverrides(overrides);
    expect(manager.hasOverride('read_file')).toBe(true);
    expect(manager.hasOverride('write_file')).toBe(true);
  });

  it('should list all registered tool names', () => {
    const names = manager.getToolNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
  });

  it('should remove an override', () => {
    const handler = vi.fn();
    manager.registerOverride('read_file', handler);
    manager.removeOverride('read_file');
    expect(manager.hasOverride('read_file')).toBe(false);
  });

  it('should handle execution errors gracefully', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Tool crashed'));
    manager.registerOverride('bad_tool', handler);

    const result = await manager.execute('bad_tool', {}, {} as any);
    expect(result.success).toBe(false);
    expect(result.output).toContain('Tool crashed');
  });
});
```

---

### T11.1.10: VSCodeStorageAdapter Unit Tests

**File**: `packages/vscode/test/unit/adapter/VSCodeStorageAdapter.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VSCodeStorageAdapter } from '../../../src/adapter/VSCodeStorageAdapter';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  unlink: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

describe('VSCodeStorageAdapter', () => {
  let adapter: VSCodeStorageAdapter;
  const storageDir = '/mock/storage';

  beforeEach(() => {
    adapter = new VSCodeStorageAdapter(storageDir);
    vi.clearAllMocks();
  });

  it('should save a session record', async () => {
    const session = { id: 's1', title: 'Test', status: 'active' };
    await adapter.saveSession(session as any);

    const fs = await import('node:fs/promises');
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should load a session record by ID', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify({ id: 's1', title: 'Test', status: 'active' })
    );

    const session = await adapter.getSession('s1');
    expect(session).toBeDefined();
    expect(session.id).toBe('s1');
  });

  it('should delete a session record', async () => {
    await adapter.deleteSession('s1');

    const fs = await import('node:fs/promises');
    expect(fs.unlink).toHaveBeenCalled();
  });

  it('should list all session IDs', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readdir).mockResolvedValueOnce(['s1.json', 's2.json'] as any);

    const ids = await adapter.listSessionIds();
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
  });

  it('should save messages for a session', async () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'hello' },
      { id: 'm2', role: 'assistant', content: 'hi' },
    ];

    await adapter.saveMessages('s1', messages as any);

    const fs = await import('node:fs/promises');
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should load messages for a session', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify([{ id: 'm1', role: 'user', content: 'hello' }])
    );

    const messages = await adapter.getMessages('s1');
    expect(messages).toHaveLength(1);
  });

  it('should save token logs', async () => {
    await adapter.saveTokenLog('s1', { inputTokens: 100, outputTokens: 50, cost: 0.01 });

    const fs = await import('node:fs/promises');
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should load token logs', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockResolvedValueOnce(
      JSON.stringify({ inputTokens: 100, outputTokens: 50, cost: 0.01 })
    );

    const log = await adapter.getTokenLog('s1');
    expect(log.inputTokens).toBe(100);
  });

  it('should save permission decisions', async () => {
    await adapter.savePermission('s1', {
      tool: 'write_file',
      decision: 'allow_always',
      timestamp: Date.now(),
    });

    const fs = await import('node:fs/promises');
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should handle missing files gracefully', async () => {
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));

    const session = await adapter.getSession('non-existent');
    expect(session).toBeNull();
  });
});
```

---

### T11.1.11: Package.json Scripts

**File**: `packages/vscode/package.json` (add to `scripts` section)

```json
{
  "scripts": {
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:unit:coverage": "vitest run --coverage",
    "test:integration": "node ./test/suite/runTests.js",
    "test:webview": "vitest run --config vitest.webview.config.ts",
    "test": "pnpm run test:unit && pnpm run test:webview"
  }
}
```

---

## T11.2: Integration Test Suite

**Status**: ⬜ Not Started
**Directory**: `packages/vscode/test/suite/`
**Estimated Effort**: 2 days

### T11.2.1: Test Runner Bootstrap

**File**: `packages/vscode/test/suite/runTests.ts`

```typescript
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './index');
    const testWorkspace = path.resolve(__dirname, '../../test-fixtures/sample-project');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspace,
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
      ],
      extensionTestsEnv: {
        AGENTX_TEST: '1',
        NODE_ENV: 'test',
      },
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
```

**File**: `packages/vscode/test/suite/index.ts`

```typescript
import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 60000,
    retries: 1,
  });

  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    glob('**/*.test.js', { cwd: testsRoot }).then((files) => {
      files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

      try {
        mocha.run((failures) => {
          if (failures > 0) {
            reject(new Error(`${failures} tests failed.`));
          } else {
            resolve();
          }
        });
      } catch (err) {
        reject(err);
      }
    }).catch(reject);
  });
}
```

---

### T11.2.2: Integration Tests

**File**: `packages/vscode/test/suite/extension.test.ts`

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

describe('Agent-X Extension Integration', () => {
  const EXTENSION_ID = 'anomalyco.agentx';

  before(async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  describe('Extension Activation', () => {
    it('should activate successfully', () => {
      const extension = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(extension, 'Extension should be found');
      assert.ok(extension.isActive, 'Extension should be active');
    });

    it('should export the expected API', () => {
      const extension = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(extension?.exports, 'Extension should export an API');
    });
  });

  describe('Command Registration', () => {
    const expectedCommands = [
      'agentx.openChat',
      'agentx.newSession',
      'agentx.switchProvider',
      'agentx.switchModel',
      'agentx.switchCrew',
      'agentx.togglePlanMode',
      'agentx.exportSession',
      'agentx.searchSessions',
      'agentx.openSettings',
      'agentx.viewMemory',
      'agentx.viewDiary',
      'agentx.editSoul',
      'agentx.steerAgent',
      'agentx.cancelGeneration',
      'agentx.copyLastResponse',
      'agentx.retryLastMessage',
      'agentx.compactSession',
      'agentx.createCheckpoint',
      'agentx.restoreCheckpoint',
      'agentx.viewPermissions',
      'agentx.revokePermission',
      'agentx.openDiagnostics',
    ];

    it('should register all expected commands', async () => {
      const registeredCommands = await vscode.commands.getCommands(true);
      for (const cmd of expectedCommands) {
        assert.ok(
          registeredCommands.includes(cmd),
          `Command ${cmd} should be registered`
        );
      }
    });

    it('should execute openChat command without error', async () => {
      await assert.doesNotReject(
        vscode.commands.executeCommand('agentx.openChat')
      );
    });

    it('should execute newSession command without error', async () => {
      await assert.doesNotReject(
        vscode.commands.executeCommand('agentx.newSession')
      );
    });
  });

  describe('Status Bar Items', () => {
    it('should have provider/model status bar item visible', async () => {
      await vscode.commands.executeCommand('agentx.openChat');
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert.ok(true, 'Status bar items created');
    });
  });

  describe('Chat Webview', () => {
    it('should open chat view in sidebar', async () => {
      await vscode.commands.executeCommand('agentx.chatView.focus');
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert.ok(true, 'Chat view focused without error');
    });
  });

  describe('Engine Initialization', () => {
    it('should initialize engine with workspace root', async () => {
      const folders = vscode.workspace.workspaceFolders;
      assert.ok(folders, 'Workspace folders should exist');
      assert.ok(folders!.length > 0, 'At least one workspace folder');

      await vscode.commands.executeCommand('agentx.openChat');
      await new Promise(resolve => setTimeout(resolve, 3000));
      assert.ok(true, 'Engine initialized with workspace');
    });
  });

  describe('Session Management', () => {
    it('should create a new session', async () => {
      await assert.doesNotReject(
        vscode.commands.executeCommand('agentx.newSession')
      );
    });

    it('should show session tree view', async () => {
      await vscode.commands.executeCommand('agentx.sessionsView.focus');
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.ok(true, 'Session tree view focused');
    });
  });

  describe('Provider/Model Switching', () => {
    it('should open provider picker without error', async () => {
      await assert.doesNotReject(
        vscode.commands.executeCommand('agentx.switchProvider')
      );
    });

    it('should open model picker without error', async () => {
      await assert.doesNotReject(
        vscode.commands.executeCommand('agentx.switchModel')
      );
    });
  });

  describe('Permission System', () => {
    it('should open permissions view', async () => {
      await assert.doesNotReject(
        vscode.commands.executeCommand('agentx.viewPermissions')
      );
    });
  });

  describe('Memory and Secret Sauce', () => {
    it('should open memory view', async () => {
      await assert.doesNotReject(
        vscode.commands.executeCommand('agentx.viewMemory')
      );
    });

    it('should open diary view', async () => {
      await assert.doesNotReject(
        vscode.commands.executeCommand('agentx.viewDiary')
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown commands gracefully', async () => {
      await assert.rejects(
        vscode.commands.executeCommand('agentx.nonExistentCommand'),
        /not found/i
      );
    });
  });
});
```

---

### T11.2.3: Test Fixtures

**File**: `packages/vscode/test-fixtures/sample-project/package.json`

```json
{
  "name": "sample-project",
  "version": "1.0.0",
  "description": "Test fixture for Agent-X VS Code extension integration tests",
  "main": "index.js"
}
```

**File**: `packages/vscode/test-fixtures/sample-project/index.js`

```javascript
function hello() {
  return 'Hello from sample project';
}

module.exports = { hello };
```

**File**: `packages/vscode/test-fixtures/sample-project/README.md`

```markdown
# Sample Project

This is a test fixture for Agent-X VS Code extension integration tests.
```

---

## T11.3: Webview Tests

**Status**: ⬜ Not Started
**Directory**: `packages/vscode/test/webview/`
**Estimated Effort**: 2 days

### T11.3.1: Webview Test Configuration

**File**: `packages/vscode/vitest.webview.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/webview/**/*.test.{ts,tsx}'],
    setupFiles: ['test/webview/setup.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@webview': path.resolve(__dirname, 'src/webview/ui'),
      '@agentx/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
```

**File**: `packages/vscode/test/webview/setup.ts`

```typescript
import '@testing-library/jest-dom';
import { vi } from 'vitest';

const mockVSCodeApi = {
  postMessage: vi.fn(),
  getState: vi.fn().mockReturnValue(null),
  setState: vi.fn(),
};

(globalThis as any).acquireVsCodeApi = vi.fn(() => mockVSCodeApi);

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

(globalThis as any).ResizeObserver = MockResizeObserver;

class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

(globalThis as any).IntersectionObserver = MockIntersectionObserver;
```

---

### T11.3.2: Message Protocol Tests

**File**: `packages/vscode/test/webview/protocol.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Webview Message Protocol', () => {
  let vscodeApi: {
    postMessage: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    setState: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vscodeApi = (globalThis as any).acquireVsCodeApi();
  });

  it('should send userMessage to extension host', () => {
    vscodeApi.postMessage({
      type: 'userMessage',
      data: { content: 'Hello agent', sessionId: 's1' },
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'userMessage',
      data: { content: 'Hello agent', sessionId: 's1' },
    });
  });

  it('should send permissionResponse to extension host', () => {
    vscodeApi.postMessage({
      type: 'permissionResponse',
      data: { requestId: 'r1', decision: 'allow_once' },
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'permissionResponse',
      data: { requestId: 'r1', decision: 'allow_once' },
    });
  });

  it('should send planApproval to extension host', () => {
    vscodeApi.postMessage({
      type: 'planApproval',
      data: { planId: 'p1', approved: true },
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'planApproval',
      data: { planId: 'p1', approved: true },
    });
  });

  it('should send cancelGeneration to extension host', () => {
    vscodeApi.postMessage({ type: 'cancelGeneration', data: {} });
    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'cancelGeneration',
      data: {},
    });
  });

  it('should send steerMessage to extension host', () => {
    vscodeApi.postMessage({
      type: 'steerMessage',
      data: { content: 'Focus on tests' },
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'steerMessage',
      data: { content: 'Focus on tests' },
    });
  });

  it('should persist state between webview re-renders', () => {
    const state = { messages: [{ id: 'm1', content: 'hello' }] };
    vscodeApi.setState(state);
    expect(vscodeApi.setState).toHaveBeenCalledWith(state);

    vscodeApi.getState.mockReturnValueOnce(state);
    expect(vscodeApi.getState()).toEqual(state);
  });

  it('should handle sessionSwitch message', () => {
    vscodeApi.postMessage({
      type: 'sessionSwitch',
      data: { sessionId: 's2' },
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'sessionSwitch',
      data: { sessionId: 's2' },
    });
  });

  it('should handle providerChange message', () => {
    vscodeApi.postMessage({
      type: 'providerChange',
      data: { providerId: 'anthropic' },
    });

    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      type: 'providerChange',
      data: { providerId: 'anthropic' },
    });
  });
});
```

---

### T11.3.3: React Component Tests

**File**: `packages/vscode/test/webview/components/MessageBubble.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../../../src/webview/ui/components/MessageBubble';

describe('MessageBubble', () => {
  const baseMessage = {
    id: 'm1',
    sessionId: 's1',
    role: 'assistant' as const,
    content: 'Hello! How can I help you?',
    toolCalls: null,
    tokenCount: 10,
    createdAt: '2026-06-03T12:00:00Z',
  };

  it('should render user message', () => {
    render(<MessageBubble message={{ ...baseMessage, role: 'user', content: 'Fix the bug' }} />);
    expect(screen.getByText('Fix the bug')).toBeInTheDocument();
  });

  it('should render assistant message', () => {
    render(<MessageBubble message={baseMessage} />);
    expect(screen.getByText('Hello! How can I help you?')).toBeInTheDocument();
  });

  it('should render markdown content', () => {
    render(
      <MessageBubble message={{ ...baseMessage, content: '**bold** and *italic*' }} />
    );
    expect(screen.getByText('bold')).toBeInTheDocument();
  });

  it('should render code blocks with syntax highlighting', () => {
    render(
      <MessageBubble
        message={{ ...baseMessage, content: '```typescript\nconst x = 1;\n```' }}
      />
    );
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
  });

  it('should show tool calls when present', () => {
    render(
      <MessageBubble
        message={{
          ...baseMessage,
          toolCalls: [
            { id: 'tc1', name: 'read_file', arguments: '{"path":"/test"}', result: 'file content' },
          ],
        }}
      />
    );
    expect(screen.getByText(/read_file/)).toBeInTheDocument();
  });

  it('should show elapsed time for assistant messages', () => {
    render(<MessageBubble message={{ ...baseMessage, elapsed: 2500 }} />);
    expect(screen.getByText(/2\.5s/)).toBeInTheDocument();
  });

  it('should show token count', () => {
    render(<MessageBubble message={{ ...baseMessage, tokenCount: 150 }} />);
    expect(screen.getByText(/150/)).toBeInTheDocument();
  });

  it('should apply correct CSS class for user vs assistant', () => {
    const { container: userContainer } = render(
      <MessageBubble message={{ ...baseMessage, role: 'user' }} />
    );
    expect(userContainer.firstChild).toHaveClass('message-user');

    const { container: assistantContainer } = render(
      <MessageBubble message={{ ...baseMessage, role: 'assistant' }} />
    );
    expect(assistantContainer.firstChild).toHaveClass('message-assistant');
  });

  it('should render reasoning section when present', () => {
    render(
      <MessageBubble
        message={{ ...baseMessage, reasoning: 'Let me think about this...' }}
      />
    );
    expect(screen.getByText(/Let me think about this/)).toBeInTheDocument();
  });
});
```

---

### T11.3.4: Streaming Message Tests

**File**: `packages/vscode/test/webview/components/StreamingMessage.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreamingMessage } from '../../../src/webview/ui/components/StreamingMessage';

describe('StreamingMessage', () => {
  it('should render partial content', () => {
    render(<StreamingMessage content="Hello wo" fullContent="Hello wo" />);
    expect(screen.getByText('Hello wo')).toBeInTheDocument();
  });

  it('should show cursor indicator while streaming', () => {
    const { container } = render(
      <StreamingMessage content="Hello" fullContent="Hello" />
    );
    expect(container.querySelector('.streaming-cursor')).toBeInTheDocument();
  });

  it('should update content as new chunks arrive', () => {
    const { rerender } = render(
      <StreamingMessage content="Hello" fullContent="Hello" />
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();

    rerender(
      <StreamingMessage content="Hello world" fullContent="Hello world" />
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('should render markdown in streaming content', () => {
    render(
      <StreamingMessage content="**bold text**" fullContent="**bold text**" />
    );
    expect(screen.getByText('bold text')).toBeInTheDocument();
  });

  it('should handle empty content', () => {
    const { container } = render(
      <StreamingMessage content="" fullContent="" />
    );
    expect(container.querySelector('.streaming-cursor')).toBeInTheDocument();
  });

  it('should handle code blocks in streaming content', () => {
    render(
      <StreamingMessage
        content="Here is code:\n```js\nconst x = 1;\n```"
        fullContent="Here is code:\n```js\nconst x = 1;\n```"
      />
    );
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
  });
});
```

---

### T11.3.5: PermissionModal Tests

**File**: `packages/vscode/test/webview/components/PermissionModal.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PermissionModal } from '../../../src/webview/ui/components/PermissionModal';

describe('PermissionModal', () => {
  const baseRequest = {
    tool: 'write_file',
    path: '/workspace/src/index.ts',
    riskLevel: 'medium',
    timestamp: Date.now(),
  };

  it('should render permission request with tool name', () => {
    render(<PermissionModal request={baseRequest} onRespond={vi.fn()} />);
    expect(screen.getByText(/write_file/)).toBeInTheDocument();
  });

  it('should display the file path', () => {
    render(<PermissionModal request={baseRequest} onRespond={vi.fn()} />);
    expect(screen.getByText(/src\/index\.ts/)).toBeInTheDocument();
  });

  it('should show risk level indicator', () => {
    render(<PermissionModal request={baseRequest} onRespond={vi.fn()} />);
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
  });

  it('should call onRespond with allow_once when Allow clicked', () => {
    const onRespond = vi.fn();
    render(<PermissionModal request={baseRequest} onRespond={onRespond} />);

    fireEvent.click(screen.getByText('Allow'));
    expect(onRespond).toHaveBeenCalledWith('allow_once');
  });

  it('should call onRespond with allow_always when Allow Always clicked', () => {
    const onRespond = vi.fn();
    render(<PermissionModal request={baseRequest} onRespond={onRespond} />);

    fireEvent.click(screen.getByText('Allow Always'));
    expect(onRespond).toHaveBeenCalledWith('allow_always');
  });

  it('should call onRespond with deny when Deny clicked', () => {
    const onRespond = vi.fn();
    render(<PermissionModal request={baseRequest} onRespond={onRespond} />);

    fireEvent.click(screen.getByText('Deny'));
    expect(onRespond).toHaveBeenCalledWith('deny');
  });

  it('should show high-risk warning for high-risk tools', () => {
    render(
      <PermissionModal
        request={{ ...baseRequest, riskLevel: 'high' }}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByText(/high risk/i)).toBeInTheDocument();
  });

  it('should disable Allow Always for high-risk tools', () => {
    render(
      <PermissionModal
        request={{ ...baseRequest, riskLevel: 'high' }}
        onRespond={vi.fn()}
      />
    );
    const allowAlwaysBtn = screen.queryByText('Allow Always');
    expect(allowAlwaysBtn).not.toBeInTheDocument();
  });
});
```

---

### T11.3.6: PlanView Tests

**File**: `packages/vscode/test/webview/components/PlanView.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanView } from '../../../src/webview/ui/components/PlanView';

describe('PlanView', () => {
  const basePlan = {
    id: 'plan-1',
    title: 'Implement feature X',
    steps: [
      { id: 'step-1', description: 'Create file A', status: 'completed' as const },
      { id: 'step-2', description: 'Modify file B', status: 'in_progress' as const },
      { id: 'step-3', description: 'Write tests', status: 'pending' as const },
    ],
  };

  it('should render plan title', () => {
    render(<PlanView plan={basePlan} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('Implement feature X')).toBeInTheDocument();
  });

  it('should render all plan steps', () => {
    render(<PlanView plan={basePlan} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('Create file A')).toBeInTheDocument();
    expect(screen.getByText('Modify file B')).toBeInTheDocument();
    expect(screen.getByText('Write tests')).toBeInTheDocument();
  });

  it('should show step status indicators', () => {
    const { container } = render(
      <PlanView plan={basePlan} onApprove={vi.fn()} onReject={vi.fn()} />
    );
    expect(container.querySelector('.step-completed')).toBeInTheDocument();
    expect(container.querySelector('.step-in-progress')).toBeInTheDocument();
    expect(container.querySelector('.step-pending')).toBeInTheDocument();
  });

  it('should call onApprove when approve button clicked', () => {
    const onApprove = vi.fn();
    render(<PlanView plan={basePlan} onApprove={onApprove} onReject={vi.fn()} />);

    fireEvent.click(screen.getByText('Approve Plan'));
    expect(onApprove).toHaveBeenCalledWith('plan-1');
  });

  it('should call onReject when reject button clicked', () => {
    const onReject = vi.fn();
    render(<PlanView plan={basePlan} onApprove={vi.fn()} onReject={onReject} />);

    fireEvent.click(screen.getByText('Reject'));
    expect(onReject).toHaveBeenCalledWith('plan-1');
  });

  it('should show progress percentage', () => {
    render(<PlanView plan={basePlan} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText(/33%/)).toBeInTheDocument();
  });
});
```

---

### T11.3.7: InputArea Tests

**File**: `packages/vscode/test/webview/components/InputArea.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InputArea } from '../../../src/webview/ui/components/InputArea';

describe('InputArea', () => {
  it('should render textarea input', () => {
    render(
      <InputArea onSend={vi.fn()} onCancel={vi.fn()} onSteer={vi.fn()} isProcessing={false} />
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('should call onSend when send button clicked', () => {
    const onSend = vi.fn();
    render(
      <InputArea onSend={onSend} onCancel={vi.fn()} onSteer={vi.fn()} isProcessing={false} />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello agent' } });
    fireEvent.click(screen.getByText('Send'));

    expect(onSend).toHaveBeenCalledWith('Hello agent');
  });

  it('should call onSend on Enter key (without shift)', () => {
    const onSend = vi.fn();
    render(
      <InputArea onSend={onSend} onCancel={vi.fn()} onSteer={vi.fn()} isProcessing={false} />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('should not send on Shift+Enter (newline)', () => {
    const onSend = vi.fn();
    render(
      <InputArea onSend={onSend} onCancel={vi.fn()} onSteer={vi.fn()} isProcessing={false} />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('should show cancel button when processing', () => {
    render(
      <InputArea onSend={vi.fn()} onCancel={vi.fn()} onSteer={vi.fn()} isProcessing={true} />
    );
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should call onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(
      <InputArea onSend={vi.fn()} onCancel={onCancel} onSteer={vi.fn()} isProcessing={true} />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('should show steer button when processing', () => {
    render(
      <InputArea onSend={vi.fn()} onCancel={vi.fn()} onSteer={vi.fn()} isProcessing={true} />
    );
    expect(screen.getByText('Steer')).toBeInTheDocument();
  });

  it('should call onSteer with steer message', () => {
    const onSteer = vi.fn();
    render(
      <InputArea onSend={vi.fn()} onCancel={vi.fn()} onSteer={onSteer} isProcessing={true} />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Focus on tests instead' } });
    fireEvent.click(screen.getByText('Steer'));

    expect(onSteer).toHaveBeenCalledWith('Focus on tests instead');
  });

  it('should clear input after sending', () => {
    const onSend = vi.fn();
    render(
      <InputArea onSend={onSend} onCancel={vi.fn()} onSteer={vi.fn()} isProcessing={false} />
    );

    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByText('Send'));

    expect(input.value).toBe('');
  });

  it('should not send empty messages', () => {
    const onSend = vi.fn();
    render(
      <InputArea onSend={onSend} onCancel={vi.fn()} onSteer={vi.fn()} isProcessing={false} />
    );

    fireEvent.click(screen.getByText('Send'));
    expect(onSend).not.toHaveBeenCalled();
  });
});
```

---

## T11.4: Native Dependency Handling

**Status**: ⬜ Not Started
**Estimated Effort**: 4 hours

### T11.4.1: Strategy Decision

**Decision**: Use **Option C** — `VSCodeStorageAdapter` (JSON-file based storage) instead of `better-sqlite3`.

**Rationale**:
- The `VSCodeStorageAdapter` was implemented in Phase 2 (`02-ENGINE-ADAPTER.md` T2.6) specifically for this purpose
- Eliminates all native binary compilation concerns
- Works identically on macOS, Linux, and Windows
- No platform-specific VSIX builds needed
- JSON file storage is sufficient for VS Code extension use cases (sessions, messages, token logs)
- The engine's `better-sqlite3` dependency is only used by the CLI/TUI storage path, not the VS Code adapter path

### T11.4.2: esbuild Configuration for Native Modules

**File**: `packages/vscode/esbuild.js` (update external list)

```javascript
const esbuild = require('esbuild');
const path = require('path');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: [
    'vscode',
    'better-sqlite3',
    'sharp',
    'playwright',
    'puppeteer',
    'electron',
  ],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  treeShaking: true,
  metafile: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    'process.env.AGENTX_VSCODE': '"1"',
  },
  loader: {
    '.node': 'file',
  },
  plugins: [
    {
      name: 'native-node-modules',
      setup(build) {
        build.onResolve({ filter: /\.node$/ }, (args) => ({
          path: require.resolve(args.path, { paths: [args.resolveDir] }),
          external: true,
        }));

        build.onResolve({ filter: /^node:/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
};

const webviewConfig = {
  entryPoints: ['src/webview/ui/index.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  treeShaking: true,
  metafile: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  loader: {
    '.svg': 'text',
    '.css': 'css',
  },
};

async function build() {
  const extResult = await esbuild.build(extensionConfig);
  const webResult = await esbuild.build(webviewConfig);

  if (process.env.ANALYZE) {
    const extAnalysis = await esbuild.analyzeMetafile(extResult.metafile, { verbose: true });
    const webAnalysis = await esbuild.analyzeMetafile(webResult.metafile, { verbose: true });
    console.log('Extension bundle analysis:\n', extAnalysis);
    console.log('Webview bundle analysis:\n', webAnalysis);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### T11.4.3: Engine Integration — Storage Adapter Selection

**File**: `packages/vscode/src/adapter/VSCodeEngine.ts` (relevant section)

```typescript
import { VSCodeStorageAdapter } from './VSCodeStorageAdapter';
import type { StorageAdapter } from '@agentx/shared';

export class VSCodeEngine {
  private storageAdapter: StorageAdapter;

  constructor(options: EngineAdapterOptions) {
    const storageDir = path.join(
      options.context.globalStorageUri.fsPath,
      'sessions'
    );
    this.storageAdapter = new VSCodeStorageAdapter(storageDir);
  }

  async initialize(): Promise<void> {
    const agent = new Agent({
      workspaceRoot: this.workspaceRoot,
      storageAdapter: this.storageAdapter,
    });
    // ...
  }
}
```

### T11.4.4: package.json Dependency Management

**File**: `packages/vscode/package.json` (dependencies section)

```json
{
  "dependencies": {
    "@agentx/engine": "workspace:*",
    "@agentx/shared": "workspace:*"
  },
  "optionalDependencies": {},
  "devDependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

`better-sqlite3` is listed as a `devDependency` only (needed for type-checking during development), never bundled into the VSIX.

---

## T11.5: VSIX Packaging

**Status**: ⬜ Not Started
**Estimated Effort**: 1 day

### T11.5.1: .vscodeignore Configuration

**File**: `packages/vscode/.vscodeignore`

```
.git/**
.github/**
.vscode/**
.vscode-test/**

src/**
test/**
test-fixtures/**
docs/**

**/*.ts
**/*.tsx
!**/*.d.ts

**/*.map
**/*.test.*
**/__mocks__/**
**/__tests__/**

node_modules/**
!node_modules/@agentx/engine/dist/**
!node_modules/@agentx/shared/dist/**

esbuild.js
esbuild.webview.js
vitest.config.ts
vitest.webview.config.ts
tsconfig.json
.eslintrc.json
.prettierrc

*.vsix

.env
.env.*
```

### T11.5.2: Build Pipeline Script

**File**: `packages/vscode/scripts/build-vsix.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VSCODE_DIR="$ROOT_DIR/packages/vscode"

echo "=== Agent-X VS Code Extension Build Pipeline ==="

echo ""
echo "Step 1/5: Building @agentx/shared..."
cd "$ROOT_DIR"
pnpm --filter @agentx/shared run build
echo "  Done: @agentx/shared built"

echo ""
echo "Step 2/5: Building @agentx/engine..."
pnpm --filter @agentx/engine run build
echo "  Done: @agentx/engine built"

echo ""
echo "Step 3/5: Building VS Code extension (esbuild)..."
cd "$VSCODE_DIR"
NODE_ENV=production node esbuild.js
echo "  Done: Extension host bundle: dist/extension.js"
echo "  Done: Webview bundle: dist/webview.js"

echo ""
echo "Step 4/5: Validating package..."
npx vsce ls --no-dependencies
echo "  Done: Package contents validated"

echo ""
echo "Step 5/5: Packaging VSIX..."
npx vsce package --no-dependencies -o "$VSCODE_DIR/agentx.vsix"
echo "  Done: VSIX created: agentx.vsix"

echo ""
VSIX_SIZE=$(du -h "$VSCODE_DIR/agentx.vsix" | cut -f1)
echo "=== Build Complete ==="
echo "  VSIX: $VSCODE_DIR/agentx.vsix ($VSIX_SIZE)"
echo ""
echo "Install with: code --install-extension agentx.vsix"
```

### T11.5.3: Package.json Build Scripts

**File**: `packages/vscode/package.json` (scripts section)

```json
{
  "scripts": {
    "build": "node esbuild.js",
    "build:prod": "NODE_ENV=production node esbuild.js",
    "watch": "node esbuild.js --watch",
    "package": "bash scripts/build-vsix.sh",
    "package:quick": "pnpm run build:prod && vsce package --no-dependencies",
    "vscode:prepublish": "pnpm run build:prod",
    "analyze": "ANALYZE=1 node esbuild.js"
  }
}
```

### T11.5.4: VSIX Size Optimization Checklist

| Optimization | Target | Implementation |
|---|---|---|
| Tree-shaking | Remove dead code | esbuild `treeShaking: true` |
| Minification | Reduce bundle size ~40% | esbuild `minify: true` in production |
| Source maps excluded | Save ~50% size | `.vscodeignore` excludes `*.map` |
| Tests excluded | N/A | `.vscodeignore` excludes `test/**` |
| Source excluded | N/A | `.vscodeignore` excludes `src/**` |
| node_modules pruned | Only runtime deps | `--no-dependencies` flag with manual include |
| Media assets optimized | < 500KB total | PNG/SVG compression |
| Final VSIX target | < 5MB | Verify with `du -h agentx.vsix` |

### T11.5.5: Bundle Size Monitoring Script

**File**: `packages/vscode/scripts/check-bundle-size.js`

```javascript
const fs = require('fs');
const path = require('path');

const MAX_EXTENSION_SIZE = 2 * 1024 * 1024;
const MAX_WEBVIEW_SIZE = 1 * 1024 * 1024;
const MAX_VSIX_SIZE = 5 * 1024 * 1024;

function checkSize(filePath, maxSize, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`  FAIL ${label}: file not found (${filePath})`);
    process.exit(1);
  }

  const stats = fs.statSync(filePath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  const maxMB = (maxSize / (1024 * 1024)).toFixed(2);

  if (stats.size > maxSize) {
    console.error(`  FAIL ${label}: ${sizeMB}MB exceeds limit of ${maxMB}MB`);
    process.exit(1);
  }

  console.log(`  PASS ${label}: ${sizeMB}MB (limit: ${maxMB}MB)`);
}

console.log('Bundle Size Check:');
checkSize(
  path.resolve(__dirname, '../dist/extension.js'),
  MAX_EXTENSION_SIZE,
  'Extension bundle'
);
checkSize(
  path.resolve(__dirname, '../dist/webview.js'),
  MAX_WEBVIEW_SIZE,
  'Webview bundle'
);

const vsixPath = path.resolve(__dirname, '../agentx.vsix');
if (fs.existsSync(vsixPath)) {
  checkSize(vsixPath, MAX_VSIX_SIZE, 'VSIX package');
}

console.log('\nAll size checks passed.');
```

---

## T11.6: Extension Manifest Polish

**Status**: ⬜ Not Started
**Estimated Effort**: 1 day

### T11.6.1: README.md

**File**: `packages/vscode/README.md`

```markdown
# Agent-X for VS Code

> AI-powered coding assistant with 165+ tools, multi-provider support,
> and autonomous agent capabilities.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/anomalyco.agentx)](https://marketplace.visualstudio.com/items?itemName=anomalyco.agentx)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/anomalyco.agentx)](https://marketplace.visualstudio.com/items?itemName=anomalyco.agentx)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

### Intelligent Chat Interface
- Streaming responses with real-time markdown rendering and syntax highlighting
- Tool execution cards showing exactly what the agent is doing
- Permission system with risk-level indicators and one-click approvals
- Plan mode for step-by-step task execution with approval gates

### 165+ Built-in Tools
Agent-X comes with a comprehensive toolkit spanning:
- **Filesystem** — Read, write, search, and transform files
- **Shell & Process** — Execute commands, manage processes
- **Git & VCS** — Full git workflow support
- **Code Intelligence** — AST analysis, refactoring, type checking
- **Web & Network** — HTTP requests, web scraping
- **Package Managers** — npm, pnpm, yarn, pip, cargo
- **Containers** — Docker, Kubernetes management
- **Database** — SQL queries, schema management
- **GitHub** — Issues, PRs, actions, releases
- **Testing** — Run and analyze test suites
- **Browser Automation** — Playwright-powered testing
- **AI Meta-Tools** — Self-reflection and optimization

### Multi-Provider Support
Switch between 15+ AI providers seamlessly:
- **Cloud**: OpenAI, Anthropic, Google, Mistral, Cohere, Together AI,
  Groq, Perplexity, DeepSeek, OpenRouter, xAI
- **Local**: Ollama, LM Studio, LocalAI, Text Generation WebUI

### Crew System
Create specialized agent personas for different tasks:
- Define custom system prompts and tool access
- Switch between crews for context-specific assistance
- Share crews across projects

### Session Management
- Persistent sessions — Resume conversations across VS Code restarts
- Session tree view — Browse, search, and manage past sessions
- Export — Save sessions as Markdown, JSON, or JSONL
- Checkpoints — Create restore points within sessions
- Session compaction — Automatic context window management

### Secret Sauce
- Memory system — Agent remembers your preferences and project context
- Diary — Automatic activity logging and daily summaries
- Soul — Customizable personality configuration
- Identity — Per-crew persona management

### Advanced Features
- Sub-agents — Parallel task delegation
- Research mode — Multi-source information gathering
- Steer — Redirect agent mid-generation
- Background tasks — Long-running operations with notifications
- File watchers — Automatic rebuild/test on file changes
- Diff preview — Review file changes before they are applied

---

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Agent-X"
4. Click Install

### From VSIX
```bash
code --install-extension agentx.vsix
```

### From Source
```bash
git clone https://github.com/anomalyco/agent-x.git
cd agent-x
pnpm install
pnpm --filter @agentx/vscode run package
code --install-extension packages/vscode/agentx.vsix
```

---

## Getting Started

### First Run Setup
1. After installation, the Agent-X sidebar icon appears in the Activity Bar
2. Click it to open the chat panel
3. The First Run Wizard will guide you through:
   - Selecting your AI provider
   - Entering your API key
   - Choosing a default model
4. Start chatting!

### API Key Configuration
API keys are stored securely in `~/.config/agentx/config.json` (encrypted at rest).

Never stored in VS Code settings — your keys stay with Agent-X, not VS Code.

---

## Configuration

### Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `agentx.provider` | Default AI provider | `openai` |
| `agentx.model` | Default model ID | Provider-specific |
| `agentx.autoApproveLowRisk` | Auto-approve low-risk tools | `true` |
| `agentx.autoApproveMediumRisk` | Auto-approve medium-risk tools | `false` |
| `agentx.permissionTimeout` | Permission prompt timeout (seconds) | `30` |
| `agentx.planMode` | Enable plan mode by default | `false` |
| `agentx.streamThrottle` | Stream update throttle (ms) | `16` |
| `agentx.maxHistoryMessages` | Max messages in webview | `200` |

---

## Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+A` | Open Agent-X Chat |
| `Ctrl+Shift+A, N` | New Session |
| `Ctrl+Shift+A, P` | Switch Provider |
| `Ctrl+Shift+A, M` | Switch Model |
| `Ctrl+Shift+A, C` | Switch Crew |
| `Ctrl+Shift+A, L` | Toggle Plan Mode |
| `Escape` | Cancel Generation |

Shortcuts are configurable in VS Code Keyboard Shortcuts settings.

---

## Screenshots

### Chat Interface
![Chat Interface](https://raw.githubusercontent.com/anomalyco/agent-x/main/packages/vscode/media/screenshots/chat-interface.png)

### Tool Execution
![Tool Execution](https://raw.githubusercontent.com/anomalyco/agent-x/main/packages/vscode/media/screenshots/tool-execution.png)

### Permission System
![Permission System](https://raw.githubusercontent.com/anomalyco/agent-x/main/packages/vscode/media/screenshots/permission-system.png)

### Session Management
![Session Management](https://raw.githubusercontent.com/anomalyco/agent-x/main/packages/vscode/media/screenshots/session-management.png)

### Plan Mode
![Plan Mode](https://raw.githubusercontent.com/anomalyco/agent-x/main/packages/vscode/media/screenshots/plan-mode.png)

---

## Troubleshooting

### Extension does not activate
- Ensure VS Code version is >= 1.90.0
- Check the Output panel (Agent-X channel) for errors
- Try reloading the window: Ctrl+Shift+P then "Developer: Reload Window"

### API key errors
- Verify your API key in `~/.config/agentx/config.json`
- Check that the key has not expired
- Ensure the provider API is accessible from your network

### Engine fails to initialize
- Check that a workspace folder is open
- Look for errors in the Agent-X output channel
- Try restarting the engine: Ctrl+Shift+P then "Agent-X: Restart Engine"

### Webview is blank
- Ensure JavaScript is not disabled in VS Code
- Try: Ctrl+Shift+P then "Developer: Reload Window"
- Check Developer Tools: Ctrl+Shift+P then "Developer: Toggle Developer Tools"

### Performance issues
- Reduce `agentx.maxHistoryMessages` if the chat is slow
- Disable unused tool categories in settings
- Use a local provider (Ollama) for faster response times

### Reporting Issues
Please report bugs at https://github.com/anomalyco/agent-x/issues

---

## License

MIT — see [LICENSE](./LICENSE) for details.
```

---

### T11.6.2: CHANGELOG.md

**File**: `packages/vscode/CHANGELOG.md`

```markdown
# Changelog

All notable changes to the Agent-X VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of Agent-X VS Code extension
- Chat sidebar with streaming markdown rendering and syntax highlighting
- 165+ built-in tools across 21 categories
- Multi-provider support (15+ providers: OpenAI, Anthropic, Google, Ollama, LM Studio, and more)
- Permission system with risk-level indicators and auto-approve
- Plan mode with step-by-step approval gates
- Session management with tree view, search, export, and checkpoints
- Crew system for specialized agent personas
- Secret Sauce: memory, diary, soul, and identity management
- Sub-agent delegation for parallel tasks
- Research mode with multi-source information gathering
- Steer functionality to redirect agent mid-generation
- Background tasks with progress notifications
- File watchers for automatic rebuild/test
- Diff preview before file modifications
- Scope guard preventing operations outside workspace
- Session compaction for context window management
- Crash recovery with session restoration
- Full keyboard shortcut support
- Light, dark, and high-contrast theme support
- ARIA labels and screen reader support

## [0.1.0] - 2026-06-03

### Added
- Initial preview release
- Core chat functionality
- Basic tool integration
- Provider configuration
```

---

### T11.6.3: LICENSE

**File**: `packages/vscode/LICENSE`

```
MIT License

Copyright (c) 2026 Anomaly Co

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### T11.6.4: Extension Icon and Screenshots

**Icon**: `packages/vscode/media/icon.png`
- 512x512 PNG
- Agent-X logo with transparency
- Must be visible on both light and dark backgrounds

**Screenshots directory**: `packages/vscode/media/screenshots/`

| File | Description | Dimensions |
|------|-------------|------------|
| `chat-interface.png` | Main chat view with conversation | 1280x720 |
| `tool-execution.png` | Tool execution cards expanded | 1280x720 |
| `permission-system.png` | Permission modal with risk indicator | 1280x720 |
| `session-management.png` | Session tree view with context menu | 1280x720 |
| `plan-mode.png` | Plan approval UI with steps | 1280x720 |

**Screenshot requirements**:
- PNG format
- Minimum 1280x720 pixels
- Show VS Code with dark theme
- Include realistic content (not placeholder text)
- Highlight the Agent-X sidebar/webview

---

### T11.6.5: Extension Manifest Metadata Verification

**File**: `packages/vscode/package.json` (contributes/galleryBanner and metadata)

```json
{
  "displayName": "Agent-X",
  "description": "AI-powered coding assistant with 165+ tools, multi-provider support, sub-agents, plan mode, and autonomous agent capabilities.",
  "publisher": "anomalyco",
  "icon": "media/icon.png",
  "galleryBanner": {
    "color": "#1a1a2e",
    "theme": "dark"
  },
  "categories": ["AI", "Machine Learning", "Other"],
  "keywords": [
    "ai",
    "agent",
    "copilot",
    "assistant",
    "agentx",
    "coding assistant",
    "code generation",
    "autonomous",
    "multi-provider",
    "plan mode"
  ],
  "pricing": "Free",
  "repository": {
    "type": "git",
    "url": "https://github.com/anomalyco/agent-x.git",
    "directory": "packages/vscode"
  },
  "bugs": {
    "url": "https://github.com/anomalyco/agent-x/issues"
  },
  "homepage": "https://github.com/anomalyco/agent-x/blob/main/packages/vscode/README.md",
  "qna": "https://github.com/anomalyco/agent-x/discussions",
  "sponsor": {
    "url": "https://github.com/sponsors/anomalyco"
  }
}
```

---

## T11.7: CI/CD Pipeline

**Status**: ⬜ Not Started
**Estimated Effort**: 1 day

### T11.7.1: PR Validation Workflow

**File**: `.github/workflows/vscode-pr.yml`

```yaml
name: VS Code Extension - PR Validation

on:
  pull_request:
    branches: [main]
    paths:
      - 'packages/vscode/**'
      - 'packages/engine/**'
      - 'packages/shared/**'
      - 'pnpm-workspace.yaml'
      - 'pnpm-lock.yaml'

concurrency:
  group: vscode-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  lint-and-typecheck:
    name: Lint and Typecheck
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Get pnpm store directory
        id: pnpm-cache
        shell: bash
        run: echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT

      - name: Setup pnpm cache
        uses: actions/cache@v4
        with:
          path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-store-

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint @agentx/shared
        run: pnpm --filter @agentx/shared run lint

      - name: Lint @agentx/engine
        run: pnpm --filter @agentx/engine run lint

      - name: Lint @agentx/vscode
        run: pnpm --filter @agentx/vscode run lint

      - name: Typecheck @agentx/shared
        run: pnpm --filter @agentx/shared run typecheck

      - name: Typecheck @agentx/engine
        run: pnpm --filter @agentx/engine run typecheck

      - name: Typecheck @agentx/vscode
        run: pnpm --filter @agentx/vscode run typecheck

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build @agentx/shared
        run: pnpm --filter @agentx/shared run build

      - name: Build @agentx/engine
        run: pnpm --filter @agentx/engine run build

      - name: Run unit tests
        run: pnpm --filter @agentx/vscode run test:unit

      - name: Run webview tests
        run: pnpm --filter @agentx/vscode run test:webview

      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: unit-test-coverage
          path: packages/vscode/coverage/
          retention-days: 7

  build-vsix:
    name: Build VSIX
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: |
          pnpm --filter @agentx/shared run build
          pnpm --filter @agentx/engine run build
          pnpm --filter @agentx/vscode run build:prod

      - name: Package VSIX
        run: |
          cd packages/vscode
          npx vsce package --no-dependencies -o agentx.vsix

      - name: Check bundle sizes
        run: node packages/vscode/scripts/check-bundle-size.js

      - name: Upload VSIX artifact
        uses: actions/upload-artifact@v4
        with:
          name: agentx-vsix
          path: packages/vscode/agentx.vsix
          retention-days: 14

  integration-tests:
    name: Integration Tests
    runs-on: ${{ matrix.os }}
    needs: build-vsix
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: |
          pnpm --filter @agentx/shared run build
          pnpm --filter @agentx/engine run build
          pnpm --filter @agentx/vscode run build:prod

      - name: Run integration tests (Linux)
        if: runner.os == 'Linux'
        run: |
          export DISPLAY=':99.0'
          Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
          sleep 3
          pnpm --filter @agentx/vscode run test:integration

      - name: Run integration tests (macOS/Windows)
        if: runner.os != 'Linux'
        run: pnpm --filter @agentx/vscode run test:integration
```

---

### T11.7.2: Release Workflow

**File**: `.github/workflows/vscode-release.yml`

```yaml
name: VS Code Extension - Release

on:
  push:
    tags:
      - 'vscode-v*'

permissions:
  contents: write

jobs:
  validate:
    name: Validate Release
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: |
          pnpm --filter @agentx/shared run build
          pnpm --filter @agentx/engine run build
          pnpm --filter @agentx/vscode run build:prod

      - name: Run unit tests
        run: pnpm --filter @agentx/vscode run test:unit

      - name: Run webview tests
        run: pnpm --filter @agentx/vscode run test:webview

      - name: Typecheck
        run: pnpm --filter @agentx/vscode run typecheck

      - name: Lint
        run: pnpm --filter @agentx/vscode run lint

  build:
    name: Build VSIX
    runs-on: ubuntu-latest
    needs: validate
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: |
          pnpm --filter @agentx/shared run build
          pnpm --filter @agentx/engine run build
          pnpm --filter @agentx/vscode run build:prod

      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/vscode-v}" >> $GITHUB_OUTPUT

      - name: Package VSIX
        run: |
          cd packages/vscode
          npx vsce package --no-dependencies -o agentx-${{ steps.version.outputs.VERSION }}.vsix

      - name: Check bundle sizes
        run: node packages/vscode/scripts/check-bundle-size.js

      - name: Upload VSIX artifact
        uses: actions/upload-artifact@v4
        with:
          name: agentx-vsix-release
          path: packages/vscode/agentx-${{ steps.version.outputs.VERSION }}.vsix
          retention-days: 30

  publish-marketplace:
    name: Publish to VS Code Marketplace
    runs-on: ubuntu-latest
    needs: build
    environment: marketplace
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Download VSIX artifact
        uses: actions/download-artifact@v4
        with:
          name: agentx-vsix-release
          path: packages/vscode/

      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/vscode-v}" >> $GITHUB_OUTPUT

      - name: Publish to VS Code Marketplace
        run: |
          cd packages/vscode
          npx vsce publish --packagePath agentx-${{ steps.version.outputs.VERSION }}.vsix --pat ${{ secrets.VSCE_PAT }}
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}

  publish-openvsx:
    name: Publish to Open VSX Registry
    runs-on: ubuntu-latest
    needs: build
    environment: openvsx
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Download VSIX artifact
        uses: actions/download-artifact@v4
        with:
          name: agentx-vsix-release
          path: packages/vscode/

      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/vscode-v}" >> $GITHUB_OUTPUT

      - name: Publish to Open VSX Registry
        run: |
          cd packages/vscode
          npx ovsx publish agentx-${{ steps.version.outputs.VERSION }}.vsix -p ${{ secrets.OVSX_TOKEN }}
        env:
          OVSX_TOKEN: ${{ secrets.OVSX_TOKEN }}

  github-release:
    name: Create GitHub Release
    runs-on: ubuntu-latest
    needs: [publish-marketplace, publish-openvsx]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/vscode-v}" >> $GITHUB_OUTPUT

      - name: Download VSIX artifact
        uses: actions/download-artifact@v4
        with:
          name: agentx-vsix-release
          path: packages/vscode/

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          name: "VS Code Extension v${{ steps.version.outputs.VERSION }}"
          body: |
            ## Agent-X VS Code Extension v${{ steps.version.outputs.VERSION }}

            ### Installation
            - **VS Code Marketplace**: Search for "Agent-X" in the Extensions panel
            - **Manual**: Download the .vsix file below and run
              `code --install-extension agentx-${{ steps.version.outputs.VERSION }}.vsix`

            ### Changelog
            See [CHANGELOG.md](https://github.com/anomalyco/agent-x/blob/main/packages/vscode/CHANGELOG.md)
            for details.
          files: packages/vscode/agentx-${{ steps.version.outputs.VERSION }}.vsix
          draft: false
          prerelease: ${{ contains(steps.version.outputs.VERSION, '-') }}
```

---

### T11.7.3: CI Environment Secrets

The following secrets must be configured in the GitHub repository:

| Secret | Description | Used By |
|--------|-------------|---------|
| `VSCE_PAT` | VS Code Marketplace Personal Access Token | `publish-marketplace` job |
| `OVSX_TOKEN` | Open VSX Registry access token | `publish-openvsx` job |

**Environment protection rules** (recommended):
- `marketplace` environment: require review for tags
- `openvsx` environment: require review for tags

---

## T11.8: Marketplace Preparation

**Status**: ⬜ Not Started
**Estimated Effort**: 4 hours

### T11.8.1: Publisher Account Setup

**VS Code Marketplace**:
1. Create an Azure DevOps organization at https://dev.azure.com
2. Create a Personal Access Token (PAT) with "Marketplace" scope:
   - Go to Azure DevOps, User Settings, Personal Access Tokens
   - Create new token with Organization: "All accessible organizations"
   - Scopes: Marketplace, Manage
3. Create a publisher at https://marketplace.visualstudio.com/manage
   - Publisher ID: `anomalyco`
   - Display Name: `Anomaly Co`
4. Install vsce CLI: `npm install -g @vscode/vsce`
5. Login: `vsce login anomalyco`

**Open VSX Registry**:
1. Create an account at https://open-vsx.org
2. Create a namespace: `anomalyco`
3. Generate an access token
4. Install ovsx CLI: `npm install -g ovsx`

### T11.8.2: vsce CLI Configuration

**File**: `packages/vscode/.vsce` (optional config file)

```json
{
  "baseContentUrl": "https://github.com/anomalyco/agent-x/blob/main/packages/vscode/",
  "baseImagesUrl": "https://raw.githubusercontent.com/anomalyco/agent-x/main/packages/vscode/",
  "dependencies": false
}
```

### T11.8.3: Pre-Publish Checklist

```
Pre-Publish Checklist
=====================

Manifest:
  [ ] displayName is set and descriptive
  [ ] description is under 150 characters and keyword-rich
  [ ] version follows semver (0.1.0 for initial release)
  [ ] publisher is set to "anomalyco"
  [ ] license is "MIT"
  [ ] icon is 512x512 PNG at media/icon.png
  [ ] categories include "AI" and "Machine Learning"
  [ ] keywords include relevant search terms
  [ ] engines.vscode is set to "^1.90.0"
  [ ] main points to "./dist/extension.js"
  [ ] repository URL is correct
  [ ] bugs URL is correct
  [ ] homepage URL is correct
  [ ] pricing is "Free"

Content:
  [ ] README.md is complete with features, installation, configuration
  [ ] CHANGELOG.md follows Keep a Changelog format
  [ ] LICENSE is MIT
  [ ] At least 3 screenshots in media/screenshots/
  [ ] Icon is visible on both light and dark backgrounds

Build:
  [ ] pnpm --filter @agentx/shared run build succeeds
  [ ] pnpm --filter @agentx/engine run build succeeds
  [ ] pnpm --filter @agentx/vscode run build:prod succeeds
  [ ] vsce package creates VSIX without errors
  [ ] VSIX size is under 5MB
  [ ] Bundle size check passes

Testing:
  [ ] Unit tests pass (pnpm run test:unit)
  [ ] Webview tests pass (pnpm run test:webview)
  [ ] Integration tests pass on macOS
  [ ] Integration tests pass on Linux
  [ ] Integration tests pass on Windows
  [ ] Manual smoke test in Extension Development Host

Security:
  [ ] No API keys in source code
  [ ] No secrets in package.json
  [ ] CSP configured for webview
  [ ] .vscodeignore excludes sensitive files

Marketplace:
  [ ] Publisher account created on VS Code Marketplace
  [ ] Publisher account created on Open VSX Registry
  [ ] VSCE_PAT secret configured in GitHub
  [ ] OVSX_TOKEN secret configured in GitHub
  [ ] Test publish to marketplace (unlisted)
  [ ] Test publish to Open VSX (unlisted)
```

### T11.8.4: Publish Commands

**File**: `packages/vscode/package.json` (additional scripts)

```json
{
  "scripts": {
    "publish:marketplace": "vsce publish --no-dependencies",
    "publish:openvsx": "ovsx publish --no-dependencies",
    "publish:all": "pnpm run publish:marketplace && pnpm run publish:openvsx"
  }
}
```

---

## T11.9: Performance Optimization

**Status**: ⬜ Not Started
**Estimated Effort**: 1 day

### T11.9.1: Extension Activation Time Optimization

**Target**: < 2 seconds from activation to ready state

| Optimization | Before Target | After Target | Implementation |
|---|---|---|---|
| Lazy engine init | Activate + Init: ~3s | Activate: ~200ms | Defer engine init until first command |
| Deferred imports | All imports at top | Dynamic imports | `await import()` for non-critical modules |
| Minimal activation events | `onStartupFinished` | `onCommand:agentx.openChat` | Only activate on explicit user action |

**File**: `packages/vscode/src/extension.ts` (activation optimization)

```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const startTime = performance.now();

  const outputChannel = vscode.window.createOutputChannel('Agent-X');
  context.subscriptions.push(outputChannel);

  const configBridge = new ConfigBridge();
  await configBridge.initialize();

  const contextKeyManager = new ContextKeyManager();
  context.subscriptions.push(contextKeyManager);

  registerAllCommands(context, { lazyEngine: true });

  const statusBarManager = new StatusBarManager();
  context.subscriptions.push(statusBarManager);

  const elapsed = performance.now() - startTime;
  outputChannel.appendLine(`[Agent-X] Activated in ${elapsed.toFixed(0)}ms`);
}
```

**File**: `packages/vscode/package.json` (activation events)

```json
{
  "activationEvents": [
    "onCommand:agentx.openChat",
    "onCommand:agentx.newSession",
    "onView:agentx.chatView",
    "onView:agentx.sessionsView"
  ]
}
```

### T11.9.2: Webview Performance

**File**: `packages/vscode/src/webview/ui/hooks/useVirtualScroll.ts`

```typescript
import { useState, useCallback, useRef, useEffect } from 'react';

interface VirtualScrollOptions {
  itemCount: number;
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}

interface VirtualScrollResult {
  visibleRange: { start: number; end: number };
  totalHeight: number;
  offsetTop: number;
  containerRef: React.RefObject<HTMLDivElement>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

export function useVirtualScroll({
  itemCount,
  itemHeight,
  containerHeight,
  overscan = 5,
}: VirtualScrollOptions): VirtualScrollResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = itemCount * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );
  const offsetTop = startIndex * itemHeight;

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      setScrollTop(container.scrollTop);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return {
    visibleRange: { start: startIndex, end: endIndex },
    totalHeight,
    offsetTop,
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    onScroll,
  };
}
```

**File**: `packages/vscode/src/webview/ui/hooks/useThrottledStream.ts`

```typescript
import { useRef, useCallback, useState } from 'react';

export function useThrottledStream(throttleMs: number = 16) {
  const [content, setContent] = useState('');
  const [fullContent, setFullContent] = useState('');
  const lastUpdateRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ content: string; fullContent: string } | null>(null);

  const updateStream = useCallback(
    (chunk: { content: string; fullContent: string }) => {
      pendingRef.current = chunk;
      const now = performance.now();
      const elapsed = now - lastUpdateRef.current;

      if (elapsed >= throttleMs) {
        lastUpdateRef.current = now;
        setContent(chunk.content);
        setFullContent(chunk.fullContent);
        pendingRef.current = null;
      } else if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingRef.current) {
            setContent(pendingRef.current.content);
            setFullContent(pendingRef.current.fullContent);
            pendingRef.current = null;
          }
          lastUpdateRef.current = performance.now();
          rafRef.current = null;
        });
      }
    },
    [throttleMs]
  );

  const resetStream = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setContent('');
    setFullContent('');
    pendingRef.current = null;
    lastUpdateRef.current = 0;
  }, []);

  return { content, fullContent, updateStream, resetStream };
}
```

### T11.9.3: Memory Optimization

**File**: `packages/vscode/src/webview/ui/hooks/useMessageLimit.ts`

```typescript
import { useCallback, useRef } from 'react';
import type { ChatMessage } from '@agentx/shared';

const DEFAULT_MAX_MESSAGES = 200;

export function useMessageLimit(maxMessages: number = DEFAULT_MAX_MESSAGES) {
  const messageCountRef = useRef(0);

  const trimMessages = useCallback(
    (messages: ChatMessage[]): ChatMessage[] => {
      if (messages.length <= maxMessages) {
        messageCountRef.current = messages.length;
        return messages;
      }

      const trimmed = messages.slice(-maxMessages);
      messageCountRef.current = trimmed.length;
      return trimmed;
    },
    [maxMessages]
  );

  return { trimMessages, messageCount: messageCountRef.current };
}
```

### T11.9.4: Performance Optimization Checklist

```
Performance Optimization Checklist
==================================

Extension Activation:
  [ ] Activation time < 2 seconds
  [ ] Engine lazy-loaded on first command
  [ ] Non-critical imports use dynamic import()
  [ ] activationEvents limited to onCommand and onView
  [ ] No synchronous file reads during activation
  [ ] Output channel logs activation time

Webview Rendering:
  [ ] Virtual scrolling for message lists > 50 items
  [ ] Stream updates throttled to 16ms (60fps)
  [ ] Markdown renderer lazy-loaded on first render
  [ ] Syntax highlighter lazy-loaded on first code block
  [ ] React.memo on MessageBubble, ToolCard, StreamingMessage
  [ ] useCallback on event handlers
  [ ] useMemo on expensive computations (markdown parsing)
  [ ] Image lazy-loading with IntersectionObserver

Memory:
  [ ] All event subscriptions disposed on deactivation
  [ ] Message history limited to maxHistoryMessages (default 200)
  [ ] No memory leaks in webview (verified with Chrome DevTools)
  [ ] Temporary files cleaned up on session delete
  [ ] Output channel cleared periodically (max 10000 lines)

Bundle Size:
  [ ] Extension bundle < 2MB (minified)
  [ ] Webview bundle < 1MB (minified)
  [ ] VSIX < 5MB total
  [ ] Tree-shaking enabled and verified
  [ ] No unused dependencies in package.json
  [ ] Source maps excluded from VSIX

Targets:
  | Metric | Before | After Target |
  |--------|--------|-------------|
  | Activation time | ~3s | < 2s |
  | Message latency | ~500ms | < 200ms |
  | Webview first paint | ~1s | < 500ms |
  | Memory (idle) | ~100MB | < 80MB |
  | Extension bundle | ~3MB | < 2MB |
  | Webview bundle | ~1.5MB | < 1MB |
  | VSIX size | ~8MB | < 5MB |
```

---

## T11.10: Accessibility

**Status**: ⬜ Not Started
**Estimated Effort**: 1 day

### T11.10.1: Webview ARIA Labels

**File**: `packages/vscode/src/webview/ui/components/MessageBubble.tsx` (accessibility additions)

```typescript
function MessageBubble({ message }: { message: ChatMessage }) {
  const roleLabel = message.role === 'user' ? 'Your message' : 'Agent response';

  return (
    <div
      className={`message message-${message.role}`}
      role="article"
      aria-label={`${roleLabel}: ${message.content.slice(0, 100)}`}
      tabIndex={0}
    >
      <div className="message-header" aria-hidden="true">
        <span className="message-role">{message.role}</span>
        {message.elapsed && (
          <span className="message-elapsed">{(message.elapsed / 1000).toFixed(1)}s</span>
        )}
      </div>
      <div className="message-content" aria-live="polite">
        <MarkdownRenderer content={message.content} />
      </div>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="message-tools" role="list" aria-label="Tool executions">
          {message.toolCalls.map(tc => (
            <ToolCard key={tc.id} toolCall={tc} role="listitem" />
          ))}
        </div>
      )}
    </div>
  );
}
```

### T11.10.2: Keyboard Navigation

**File**: `packages/vscode/src/webview/ui/hooks/useKeyboardNavigation.ts`

```typescript
import { useCallback, useEffect } from 'react';

export function useKeyboardNavigation(containerRef: React.RefObject<HTMLElement>) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const container = containerRef.current;
    if (!container) return;

    switch (e.key) {
      case 'Tab': {
        const focusable = container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
        break;
      }

      case 'Escape': {
        const modal = container.querySelector('[role="dialog"]');
        if (modal) {
          const closeBtn = modal.querySelector<HTMLElement>('[data-action="close"]');
          closeBtn?.focus();
          closeBtn?.click();
        }
        break;
      }

      case 'Enter': {
        const focused = document.activeElement as HTMLElement;
        if (focused && focused.getAttribute('role') === 'button') {
          focused.click();
        }
        break;
      }
    }
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, handleKeyDown]);
}
```

### T11.10.3: Screen Reader Announcements

**File**: `packages/vscode/src/webview/ui/hooks/useScreenReader.ts`

```typescript
import { useCallback, useRef } from 'react';

export function useScreenReader() {
  const liveRegionRef = useRef<HTMLDivElement | null>(null);

  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (!liveRegionRef.current) {
      const region = document.createElement('div');
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', priority);
      region.setAttribute('aria-atomic', 'true');
      region.className = 'sr-only';
      region.style.cssText =
        'position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
        'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
      document.body.appendChild(region);
      liveRegionRef.current = region;
    }

    liveRegionRef.current.setAttribute('aria-live', priority);
    liveRegionRef.current.textContent = '';

    requestAnimationFrame(() => {
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = message;
      }
    });
  }, []);

  const announceNewMessage = useCallback((role: string, preview: string) => {
    announce(`${role} message: ${preview}`);
  }, [announce]);

  const announceToolStart = useCallback((toolName: string) => {
    announce(`Executing tool: ${toolName}`, 'assertive');
  }, [announce]);

  const announceToolComplete = useCallback((toolName: string) => {
    announce(`Tool ${toolName} completed`);
  }, [announce]);

  const announcePermissionRequest = useCallback((tool: string, risk: string) => {
    announce(`Permission required for ${tool} (${risk} risk)`, 'assertive');
  }, [announce]);

  const announceError = useCallback((message: string) => {
    announce(`Error: ${message}`, 'assertive');
  }, [announce]);

  return {
    announce,
    announceNewMessage,
    announceToolStart,
    announceToolComplete,
    announcePermissionRequest,
    announceError,
  };
}
```

### T11.10.4: High Contrast Theme Support

**File**: `packages/vscode/src/webview/ui/styles/high-contrast.css`

```css
body.vscode-high-contrast .message {
  border: 1px solid var(--vscode-contrastBorder);
}

body.vscode-high-contrast .message-user {
  border-left: 3px solid var(--vscode-contrastActiveBorder);
}

body.vscode-high-contrast .message-assistant {
  border-left: 3px solid var(--vscode-contrastBorder);
}

body.vscode-high-contrast .tool-card {
  border: 1px solid var(--vscode-contrastBorder);
}

body.vscode-high-contrast .tool-card-status-completed {
  color: var(--vscode-testing-iconPassed);
}

body.vscode-high-contrast .tool-card-status-error {
  color: var(--vscode-testing-iconFailed);
}

body.vscode-high-contrast .permission-modal {
  border: 2px solid var(--vscode-contrastActiveBorder);
}

body.vscode-high-contrast .risk-high {
  background-color: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
}

body.vscode-high-contrast .risk-medium {
  background-color: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
}

body.vscode-high-contrast .risk-low {
  background-color: var(--vscode-inputValidation-infoBackground);
  border: 1px solid var(--vscode-inputValidation-infoBorder);
}

body.vscode-high-contrast button {
  border: 1px solid var(--vscode-contrastBorder);
}

body.vscode-high-contrast button:focus {
  outline: 2px solid var(--vscode-contrastActiveBorder);
  outline-offset: 2px;
}

body.vscode-high-contrast a {
  color: var(--vscode-textLink-foreground);
  text-decoration: underline;
}

body.vscode-high-contrast code {
  border: 1px solid var(--vscode-contrastBorder);
}

body.vscode-high-contrast .streaming-cursor {
  background-color: var(--vscode-contrastActiveBorder);
}

body.vscode-high-contrast .sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### T11.10.5: Accessibility Audit Checklist

```
Accessibility Audit Checklist
==============================

ARIA:
  [ ] All interactive elements have aria-label or aria-labelledby
  [ ] Message bubbles have role="article" with descriptive labels
  [ ] Tool cards have role="listitem" within role="list" container
  [ ] Permission modal has role="dialog" with aria-modal="true"
  [ ] Plan view has role="region" with aria-label
  [ ] Input area textarea has aria-label="Message input"
  [ ] Send button has aria-label="Send message"
  [ ] Cancel button has aria-label="Cancel generation"
  [ ] Steer button has aria-label="Steer agent"
  [ ] Error banners have role="alert"
  [ ] Loading indicators have role="progressbar"

Keyboard:
  [ ] All buttons focusable via Tab
  [ ] Focus trap in permission modal
  [ ] Escape closes modals
  [ ] Enter activates focused buttons
  [ ] Tab order follows visual layout
  [ ] Focus visible on all interactive elements
  [ ] Skip-to-content link available

Screen Reader:
  [ ] New messages announced via aria-live region
  [ ] Tool execution start announced (assertive)
  [ ] Tool execution complete announced (polite)
  [ ] Permission requests announced (assertive)
  [ ] Error states announced (assertive)
  [ ] Streaming content announced periodically
  [ ] Session changes announced

Visual:
  [ ] High contrast theme fully supported
  [ ] Light theme fully supported
  [ ] Dark theme fully supported
  [ ] Focus indicators visible in all themes
  [ ] Color is not the only indicator (icons/text also used)
  [ ] Text contrast ratio >= 4.5:1 for normal text
  [ ] Text contrast ratio >= 3:1 for large text
  [ ] Interactive element contrast >= 3:1
```

---

## T11.11: Security Review

**Status**: ⬜ Not Started
**Estimated Effort**: 1 day

### T11.11.1: Content Security Policy for Webview

**File**: `packages/vscode/src/webview/ChatViewProvider.ts` (CSP section)

```typescript
function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'webview.css')
  );

  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';
             img-src ${webview.cspSource} data:;
             font-src ${webview.cspSource};
             connect-src 'none';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Agent-X Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

### T11.11.2: API Key Handling Security

```
API Key Security Rules
======================

1. NEVER store API keys in VS Code settings (workspaceState/globalState)
2. NEVER log API keys to the output channel
3. NEVER display API keys in any UI element
4. NEVER include API keys in webview messages
5. API keys stored ONLY in ~/.config/agentx/config.json
6. Config file encrypted at rest via ConfigManager DEK (Data Encryption Key)
7. Config file permissions set to 0600 (owner read/write only)
8. API keys masked in any diagnostic output (show only last 4 chars)
9. API keys never sent to webview (all LLM calls happen in extension host)
10. API keys cleared from memory on disposal
```

**File**: `packages/vscode/src/adapter/ConfigBridge.ts` (key masking)

```typescript
export function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return '****';
  return '*'.repeat(key.length - 4) + key.slice(-4);
}
```

### T11.11.3: Scope Enforcement Verification

**File**: `packages/vscode/test/unit/security/scopeEnforcement.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { ScopeGuardAdapter } from '../../../src/adapter/ScopeGuardAdapter';

describe('Scope Enforcement Security', () => {
  it('should block absolute paths outside workspace', () => {
    const guard = new ScopeGuardAdapter('/workspace/project');
    expect(guard.validate('/etc/passwd')).toBe(false);
    expect(guard.validate('/root/.ssh/id_rsa')).toBe(false);
    expect(guard.validate('/home/user/.bashrc')).toBe(false);
  });

  it('should block path traversal', () => {
    const guard = new ScopeGuardAdapter('/workspace/project');
    expect(guard.validate('/workspace/project/../../etc/passwd')).toBe(false);
    expect(guard.validate('/workspace/project/../../../root/.ssh')).toBe(false);
  });

  it('should block null byte injection', () => {
    const guard = new ScopeGuardAdapter('/workspace/project');
    expect(guard.validate('/workspace/project/file.txt\0/etc/passwd')).toBe(false);
  });

  it('should block symlink escapes', () => {
    const guard = new ScopeGuardAdapter('/workspace/project');
    const result = guard.validateWithSymlinks('/workspace/project/symlink-outside');
    expect(result.valid).toBe(false);
  });

  it('should block access to .git directory', () => {
    const guard = new ScopeGuardAdapter('/workspace/project');
    expect(guard.validate('/workspace/project/.git/config')).toBe(false);
    expect(guard.validate('/workspace/project/.git/HEAD')).toBe(false);
  });

  it('should block access to .env files', () => {
    const guard = new ScopeGuardAdapter('/workspace/project');
    expect(guard.validate('/workspace/project/.env')).toBe(false);
    expect(guard.validate('/workspace/project/.env.local')).toBe(false);
    expect(guard.validate('/workspace/project/.env.production')).toBe(false);
  });

  it('should allow paths within workspace', () => {
    const guard = new ScopeGuardAdapter('/workspace/project');
    expect(guard.validate('/workspace/project/src/index.ts')).toBe(true);
    expect(guard.validate('/workspace/project/package.json')).toBe(true);
    expect(guard.validate('/workspace/project/deep/nested/file.ts')).toBe(true);
  });
});
```

### T11.11.4: Input Sanitization

**File**: `packages/vscode/src/webview/ui/utils/sanitize.ts`

```typescript
import DOMPurify from 'dompurify';

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'span', 'div', 'del', 'sup', 'sub',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class', 'id',
      'target', 'rel', 'width', 'height',
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
  });
}

export function sanitizeUserInput(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .slice(0, 100000);
}
```

### T11.11.5: Security Review Checklist

```
Security Review Checklist
=========================

Content Security Policy:
  [ ] CSP meta tag present in webview HTML
  [ ] No inline scripts (nonce-based only)
  [ ] No inline styles except via webview.cspSource
  [ ] No external network requests from webview (connect-src: 'none')
  [ ] Only bundled resources loaded (script-src, style-src)
  [ ] CSP nonce generated randomly per webview load
  [ ] img-src limited to webview.cspSource and data:

API Key Handling:
  [ ] API keys never stored in VS Code settings
  [ ] API keys never logged to output channel
  [ ] API keys never displayed in UI
  [ ] API keys never sent to webview via postMessage
  [ ] API keys stored only in ~/.config/agentx/config.json
  [ ] Config file encrypted at rest via DEK
  [ ] Config file permissions 0600
  [ ] API keys masked in diagnostic output

Scope Enforcement:
  [ ] No tool can operate outside workspace root
  [ ] Path traversal attacks blocked
  [ ] Symlink escape prevention verified
  [ ] Null byte injection blocked
  [ ] .git directory access blocked
  [ ] .env file access blocked
  [ ] Multi-root workspace support validated

Input Sanitization:
  [ ] User messages sanitized before LLM submission
  [ ] Markdown rendered with DOMPurify
  [ ] HTML injection blocked in webview
  [ ] XSS vectors neutralized
  [ ] Input length limited (100KB max)

Dependency Security:
  [ ] No known vulnerabilities (npm audit clean)
  [ ] Dependencies pinned to specific versions
  [ ] No dev dependencies in production bundle
  [ ] Supply chain verified (lockfile integrity)

Code Security:
  [ ] No eval() or Function() constructor usage
  [ ] No child_process.exec with user input
  [ ] No fs.writeFile with unsanitized paths
  [ ] No secrets hardcoded in source
  [ ] No debug endpoints or backdoors
  [ ] Error messages do not leak sensitive info
```

---

## T11.12: Final Verification

**Status**: ⬜ Not Started
**Estimated Effort**: 2 days

### T11.12.1: Cross-Platform End-to-End Testing

```
End-to-End Test Matrix
======================

| Test Case | macOS (arm64) | macOS (x64) | Linux (x64) | Windows (x64) |
|-----------|:---:|:---:|:---:|:---:|
| Extension activates | [ ] | [ ] | [ ] | [ ] |
| Chat webview opens | [ ] | [ ] | [ ] | [ ] |
| Send message, receive response | [ ] | [ ] | [ ] | [ ] |
| Streaming renders correctly | [ ] | [ ] | [ ] | [ ] |
| Tool execution cards display | [ ] | [ ] | [ ] | [ ] |
| Permission modal appears and resolves | [ ] | [ ] | [ ] | [ ] |
| Session create works | [ ] | [ ] | [ ] | [ ] |
| Session restore works | [ ] | [ ] | [ ] | [ ] |
| Session delete works | [ ] | [ ] | [ ] | [ ] |
| Provider switching works | [ ] | [ ] | [ ] | [ ] |
| Model switching works | [ ] | [ ] | [ ] | [ ] |
| Crew switching works | [ ] | [ ] | [ ] | [ ] |
| Plan mode toggle works | [ ] | [ ] | [ ] | [ ] |
| Plan approval flow works | [ ] | [ ] | [ ] | [ ] |
| Steer mid-generation works | [ ] | [ ] | [ ] | [ ] |
| Cancel generation works | [ ] | [ ] | [ ] | [ ] |
| Session export (Markdown) | [ ] | [ ] | [ ] | [ ] |
| Session export (JSON) | [ ] | [ ] | [ ] | [ ] |
| Checkpoint create/restore | [ ] | [ ] | [ ] | [ ] |
| Memory tree view renders | [ ] | [ ] | [ ] | [ ] |
| Diary tree view renders | [ ] | [ ] | [ ] | [ ] |
| Soul editor opens | [ ] | [ ] | [ ] | [ ] |
| Diff preview shows correctly | [ ] | [ ] | [ ] | [ ] |
| Diff accept/reject works | [ ] | [ ] | [ ] | [ ] |
| Dark theme renders correctly | [ ] | [ ] | [ ] | [ ] |
| Light theme renders correctly | [ ] | [ ] | [ ] | [ ] |
| High contrast theme works | [ ] | [ ] | [ ] | [ ] |
| Keyboard navigation works | [ ] | [ ] | [ ] | [ ] |
| Screen reader announces events | [ ] | [ ] | [ ] | [ ] |
| Extension deactivates cleanly | [ ] | [ ] | [ ] | [ ] |
```

### T11.12.2: Provider Testing Matrix

```
Provider Test Matrix
====================

| Provider | Model | Connect | Send/Receive | Streaming | Tool Calls | Status |
|----------|-------|:-------:|:------------:|:---------:|:----------:|:------:|
| OpenAI | gpt-4 | [ ] | [ ] | [ ] | [ ] | [ ] |
| OpenAI | gpt-4-turbo | [ ] | [ ] | [ ] | [ ] | [ ] |
| Anthropic | claude-3-opus | [ ] | [ ] | [ ] | [ ] | [ ] |
| Anthropic | claude-3-sonnet | [ ] | [ ] | [ ] | [ ] | [ ] |
| Google | gemini-pro | [ ] | [ ] | [ ] | [ ] | [ ] |
| Google | gemini-1.5-pro | [ ] | [ ] | [ ] | [ ] | [ ] |
| Ollama | llama3 | [ ] | [ ] | [ ] | [ ] | [ ] |
| LM Studio | local-model | [ ] | [ ] | [ ] | [ ] | [ ] |
```

### T11.12.3: Command Verification

```
Command Verification (All 22 Commands)
======================================

| # | Command | Registered | Executes | UI Updates | Status |
|---|---------|:----------:|:--------:|:----------:|:------:|
| 1 | agentx.openChat | [ ] | [ ] | [ ] | [ ] |
| 2 | agentx.newSession | [ ] | [ ] | [ ] | [ ] |
| 3 | agentx.switchProvider | [ ] | [ ] | [ ] | [ ] |
| 4 | agentx.switchModel | [ ] | [ ] | [ ] | [ ] |
| 5 | agentx.switchCrew | [ ] | [ ] | [ ] | [ ] |
| 6 | agentx.togglePlanMode | [ ] | [ ] | [ ] | [ ] |
| 7 | agentx.exportSession | [ ] | [ ] | [ ] | [ ] |
| 8 | agentx.searchSessions | [ ] | [ ] | [ ] | [ ] |
| 9 | agentx.openSettings | [ ] | [ ] | [ ] | [ ] |
| 10 | agentx.viewMemory | [ ] | [ ] | [ ] | [ ] |
| 11 | agentx.viewDiary | [ ] | [ ] | [ ] | [ ] |
| 12 | agentx.editSoul | [ ] | [ ] | [ ] | [ ] |
| 13 | agentx.steerAgent | [ ] | [ ] | [ ] | [ ] |
| 14 | agentx.cancelGeneration | [ ] | [ ] | [ ] | [ ] |
| 15 | agentx.copyLastResponse | [ ] | [ ] | [ ] | [ ] |
| 16 | agentx.retryLastMessage | [ ] | [ ] | [ ] | [ ] |
| 17 | agentx.compactSession | [ ] | [ ] | [ ] | [ ] |
| 18 | agentx.createCheckpoint | [ ] | [ ] | [ ] | [ ] |
| 19 | agentx.restoreCheckpoint | [ ] | [ ] | [ ] | [ ] |
| 20 | agentx.viewPermissions | [ ] | [ ] | [ ] | [ ] |
| 21 | agentx.revokePermission | [ ] | [ ] | [ ] | [ ] |
| 22 | agentx.openDiagnostics | [ ] | [ ] | [ ] | [ ] |
```

### T11.12.4: Status Bar Verification

```
Status Bar Verification
=======================

| Item | Position | Visible | Updates | Clickable | Status |
|------|----------|:-------:|:-------:|:---------:|:------:|
| Provider/Model | Left | [ ] | [ ] | [ ] | [ ] |
| Token Usage | Left | [ ] | [ ] | N/A | [ ] |
| Cost | Left | [ ] | [ ] | N/A | [ ] |
| Plan Mode | Right | [ ] | [ ] | [ ] | [ ] |
| Watchers | Right | [ ] | [ ] | N/A | [ ] |
| Schedulers | Right | [ ] | [ ] | N/A | [ ] |
| Sub-agents | Right | [ ] | [ ] | N/A | [ ] |
```

### T11.12.5: Tree View Verification

```
Tree View Verification
======================

| View | Registered | Renders | Context Menu | Refresh | Status |
|------|:----------:|:-------:|:------------:|:-------:|:------:|
| Sessions | [ ] | [ ] | [ ] | [ ] | [ ] |
| Memory | [ ] | [ ] | [ ] | [ ] | [ ] |
| Diary | [ ] | [ ] | [ ] | [ ] | [ ] |
| Permissions | [ ] | [ ] | [ ] | [ ] | [ ] |
```

### T11.12.6: Performance Benchmarks

```
Performance Benchmarks
======================

| Metric | Target | Actual | Status |
|--------|--------|--------|:------:|
| Extension activation time | < 2s | ___ms | [ ] |
| Chat webview first paint | < 500ms | ___ms | [ ] |
| Message send-to-first-token | < 200ms | ___ms | [ ] |
| Stream update latency | < 16ms | ___ms | [ ] |
| Session restore time | < 1s | ___ms | [ ] |
| Tool execution card render | < 50ms | ___ms | [ ] |
| Permission modal render | < 100ms | ___ms | [ ] |
| Memory (idle, no session) | < 80MB | ___MB | [ ] |
| Memory (active session, 50 msgs) | < 150MB | ___MB | [ ] |
| Extension bundle size | < 2MB | ___MB | [ ] |
| Webview bundle size | < 1MB | ___MB | [ ] |
| VSIX total size | < 5MB | ___MB | [ ] |
```

### T11.12.7: Theme Verification

```
Theme Verification
==================

| Theme | Chat BG | Message BG | Text | Code Blocks | Buttons | Status |
|-------|:-------:|:----------:|:----:|:-----------:|:-------:|:------:|
| Dark+ (default) | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Light+ | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| High Contrast | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| High Contrast Light | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Solarized Dark | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Monokai | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
```

### T11.12.8: Final Sign-Off

```
Final Sign-Off
==============

Phase 11 Complete:
  [ ] T11.1  Unit Test Suite — all tests passing
  [ ] T11.2  Integration Test Suite — all tests passing
  [ ] T11.3  Webview Tests — all tests passing
  [ ] T11.4  Native Dependency Handling — Option C verified
  [ ] T11.5  VSIX Packaging — VSIX builds and installs correctly
  [ ] T11.6  Extension Manifest Polish — README, CHANGELOG, LICENSE complete
  [ ] T11.7  CI/CD Pipeline — workflows configured and tested
  [ ] T11.8  Marketplace Preparation — publisher accounts ready
  [ ] T11.9  Performance Optimization — all targets met
  [ ] T11.10 Accessibility — audit checklist complete
  [ ] T11.11 Security Review — all checks passed
  [ ] T11.12 Final Verification — all matrices complete

Ready for Release:
  [ ] All phases (1-11) complete
  [ ] All tests passing on all platforms
  [ ] VSIX packaged and verified
  [ ] CI/CD pipeline operational
  [ ] Marketplace accounts configured
  [ ] Security review passed
  [ ] Accessibility audit passed
  [ ] Performance targets met

Signed off by: _______________
Date: _______________
```
