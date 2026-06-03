import { vi } from 'vitest';

export class MockEventEmitter {
  private listeners: Array<(...args: unknown[]) => void> = [];
  event = (listener: (...args: unknown[]) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data?: unknown) { this.listeners.forEach(l => l(data)); }
  dispose() { this.listeners = []; }
}

export class MockTreeItem {
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

export class MockUri {
  fsPath: string;
  path: string;
  scheme: string;
  constructor(fsPath: string) {
    this.fsPath = fsPath;
    this.path = fsPath;
    this.scheme = 'file';
  }
  static file(path: string) { return new MockUri(path); }
  static parse(str: string) { const u = new MockUri(str); u.scheme = 'https'; return u; }
  static joinPath(base: MockUri, ...segments: string[]) {
    return new MockUri([base.fsPath, ...segments].join('/'));
  }
}

const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
const StatusBarAlignment = { Left: 1, Right: 2 };
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

const mockWindow = {
  createOutputChannel: vi.fn().mockReturnValue({ appendLine: vi.fn(), dispose: vi.fn() }),
  createStatusBarItem: vi.fn().mockReturnValue({
    text: '', tooltip: '', command: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
  }),
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showInputBox: vi.fn().mockResolvedValue(undefined),
  showQuickPick: vi.fn().mockResolvedValue(undefined),
  createTreeView: vi.fn().mockReturnValue({ onDidChangeSelection: vi.fn(), dispose: vi.fn() }),
  registerTreeDataProvider: vi.fn(),
  registerWebviewViewProvider: vi.fn(),
  withProgress: vi.fn(),
  setStatusBarMessage: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  activeTextEditor: null,
  tabGroups: { onDidChangeTabGroups: vi.fn(), all: [] },
};

const mockWorkspace = {
  workspaceFolders: [{ uri: MockUri.file('/mock/workspace'), name: 'mock', index: 0 }],
  fs: { readDirectory: vi.fn().mockResolvedValue([]), readFile: vi.fn(), writeFile: vi.fn() },
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn(), update: vi.fn(), has: vi.fn(), inspect: vi.fn(),
  }),
  onDidChangeConfiguration: vi.fn(),
  onDidChangeWorkspaceFolders: vi.fn(),
  openTextDocument: vi.fn().mockResolvedValue({}),
};

const mockCommands = {
  registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  executeCommand: vi.fn().mockResolvedValue(undefined),
};

const mockEnv = {
  machineId: 'test-machine',
  sessionId: 'test-session',
  appName: 'VS Code Test',
  appRoot: '/mock/vscode',
  language: 'en',
  uriScheme: 'vscode',
};

export const window = mockWindow;
export const workspace = mockWorkspace;
export const commands = mockCommands;
export const env = mockEnv;
export const Uri = MockUri as any;
export const ThemeIcon = vi.fn().mockImplementation((id: string) => ({ id }));
export const EventEmitter = MockEventEmitter;
export const TreeItem = MockTreeItem;
export { TreeItemCollapsibleState, StatusBarAlignment, ConfigurationTarget };
export const FileType = { File: 1, Directory: 2, SymbolicLink: 64, Unknown: 0 };
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };
export const ProgressLocation = { Notification: 15, Window: 10 };
