import * as vscode from 'vscode';
import { EngineLifecycle } from './adapter/EngineLifecycle';
import { ConfigBridge } from './adapter/ConfigBridge';
import { EventBridge } from './adapter/EventBridge';
import { StatusBarManager } from './statusbar/StatusBarManager';
import { ContextKeyManager } from './context/ContextKeyManager';
import { registerAllCommands } from './commands/registerAllCommands';
import { SessionTreeProvider } from './views/SessionTreeProvider';
import { ChatViewProvider } from './webview/ChatViewProvider';
import { ConfigurationWatcher } from './config/ConfigurationWatcher';
import { WorkspaceWatcher } from './config/WorkspaceWatcher';
import { ConfigFileWatcher } from './config/ConfigFileWatcher';
import { ConfigSync } from './config/ConfigSync';
import { FirstRunWizard } from './wizard/FirstRunWizard';
import { SessionPersistence } from './adapter/SessionPersistence';
import { SessionLifecycle } from './adapter/SessionLifecycle';
import { CheckpointManager } from './adapter/CheckpointManager';
import { CrashRecoveryAdapter } from './adapter/CrashRecoveryAdapter';
import { MemoryTreeProvider } from './providers/MemoryTreeProvider';
import { DiaryTreeProvider } from './providers/DiaryTreeProvider';
import { MemoryEditor } from './commands/MemoryEditor';
import { SoulEditor } from './commands/SoulEditor';
import { SecretSauceBrowser } from './commands/SecretSauceBrowser';
import { MemoryExtractionNotifier } from './secret-sauce/MemoryExtractionNotifier';
import { SessionModes } from './adapter/SessionModes';
import { ClarificationHandler } from './adapter/ClarificationHandler';
import { SteerHandler } from './adapter/SteerHandler';
import { RAGAdapter } from './adapter/RAGAdapter';
import { SchedulerAdapter } from './adapter/SchedulerAdapter';
import { MCPManager } from './commands/MCPManager';
import { SkillsAdapter } from './adapter/SkillsAdapter';
import { deleteEngineInstance } from './engineSingleton';
import { disposeDiagnostics } from './adapter/tools/lint';

let extensionContext: vscode.ExtensionContext;
let engineLifecycle: EngineLifecycle;
let configBridge: ConfigBridge;
let eventBridge: EventBridge;
let statusBarManager: StatusBarManager;
let contextKeyManager: ContextKeyManager;
let sessionPersistence: SessionPersistence;

export function getExtensionContext(): vscode.ExtensionContext {
  return extensionContext;
}

export function getEngineLifecycle(): EngineLifecycle {
  return engineLifecycle;
}

export function getConfigBridge(): ConfigBridge {
  return configBridge;
}

export function getEventBridge(): EventBridge {
  return eventBridge;
}

export function getStatusBarManager(): StatusBarManager {
  return statusBarManager;
}

export function getContextKeyManager(): ContextKeyManager {
  return contextKeyManager;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;

  const outputChannel = vscode.window.createOutputChannel('Agent-X');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('[Agent-X] Extension activating...');

  // Step 1: Initialize ConfigBridge
  configBridge = new ConfigBridge(context);
  configBridge.initialize();

  // Step 2: Initialize ContextKeyManager
  contextKeyManager = new ContextKeyManager();
  context.subscriptions.push(contextKeyManager);

  const isConfigured = configBridge.isConfigured();
  contextKeyManager.set('agentx.isConfigured', isConfigured);

  // Step 3: First-run wizard if no config exists
  if (!isConfigured) {
    const wizard = new FirstRunWizard(configBridge);
    const completed = await wizard.run();
    if (!completed) {
      outputChannel.appendLine('[Agent-X] First-run wizard cancelled. Extension partially active.');
      contextKeyManager.set('agentx.isConfigured', false);
    } else {
      contextKeyManager.set('agentx.isConfigured', true);
    }
  }

  // Step 4: Initialize EngineLifecycle (lazy)
  engineLifecycle = new EngineLifecycle(context);
  context.subscriptions.push(engineLifecycle);

  // Step 5: Initialize EventBridge
  eventBridge = new EventBridge(engineLifecycle);
  context.subscriptions.push(eventBridge);

  // Step 6: Initialize StatusBarManager
  statusBarManager = new StatusBarManager(configBridge, engineLifecycle);
  context.subscriptions.push(statusBarManager);

  // Step 7: Register all commands
  const commandDeps = {
    engineLifecycle,
    configBridge,
    eventBridge,
    statusBarManager,
    contextKeyManager,
    outputChannel,
  };
  registerAllCommands(context, commandDeps);

  // Step 7.5: Initialize ConfigSync (bidirectional config file sync)
  const configSync = new ConfigSync(commandDeps);
  context.subscriptions.push(configSync);

  // Step 8: Register TreeDataProviders
  const sessionTreeProvider = new SessionTreeProvider(engineLifecycle);
  const sessionTreeView = vscode.window.createTreeView('agentx.sessionsView', {
    treeDataProvider: sessionTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(sessionTreeView);

  // Step 9: Register WebviewViewProvider for chat sidebar
  const chatViewProvider = new ChatViewProvider(context.extensionUri, engineLifecycle, eventBridge, configBridge);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('agentx.chatView', chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Step 9.5: Initialize Phase 7 components (Session Management)
  sessionPersistence = new SessionPersistence();
  context.subscriptions.push(sessionPersistence);

  const sessionLifecycle = new SessionLifecycle(
    engineLifecycle,
    eventBridge,
    chatViewProvider,
    sessionTreeProvider,
    sessionPersistence,
  );
  context.subscriptions.push(sessionLifecycle);

  const checkpointManager = new CheckpointManager(sessionPersistence);

  const crashRecoveryAdapter = new CrashRecoveryAdapter(sessionLifecycle);
  context.subscriptions.push(crashRecoveryAdapter);

  // Register Phase 7 commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.duplicate', async (item) => {
      const sessionId = item?.session?.id || item;
      if (!sessionId) {
        vscode.window.showWarningMessage('No session selected.');
        return;
      }
      await sessionLifecycle.duplicateSession(sessionId);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.filter', async () => {
      const text = await vscode.window.showInputBox({
        prompt: 'Filter sessions',
        placeHolder: 'Type to filter by title, ID, or crew...',
        value: '',
      });
      sessionTreeProvider.setFilter(text ?? '');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.checkpoint.create', async (item) => {
      const sessionId = item?.session?.id || sessionLifecycle.getCurrentSessionId();
      if (!sessionId) {
        vscode.window.showWarningMessage('No active session.');
        return;
      }
      const label = await vscode.window.showInputBox({
        prompt: 'Checkpoint label (optional)',
        placeHolder: 'e.g., "Before refactoring"',
      });
      const messages = sessionLifecycle.getCurrentMessages();
      checkpointManager.createCheckpoint(sessionId, messages, label || undefined);
      vscode.window.showInformationMessage(`Checkpoint created.`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.checkpoint.list', async (item) => {
      const sessionId = item?.session?.id || sessionLifecycle.getCurrentSessionId();
      if (!sessionId) {
        vscode.window.showWarningMessage('No active session.');
        return;
      }
      const checkpoints = checkpointManager.listCheckpoints(sessionId);
      if (checkpoints.length === 0) {
        vscode.window.showInformationMessage('No checkpoints for this session.');
        return;
      }
      interface CheckpointPickItem extends vscode.QuickPickItem {
        checkpointId: string;
      }
      const items: CheckpointPickItem[] = checkpoints.map((cp) => ({
        label: cp.label,
        description: `${cp.messageCount} messages · ${new Date(cp.createdAt).toLocaleString()}`,
        checkpointId: cp.id,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a checkpoint to restore',
      });
      if (!selected) return;
      const restored = checkpointManager.restoreCheckpoint(
        sessionId,
        selected.checkpointId,
        sessionLifecycle.getCurrentMessages(),
      );
      if (restored) {
        chatViewProvider.postToWebview('clearMessages', {});
        chatViewProvider.postToWebview('sessionRestored', {
          sessionId,
          title: 'Restored from checkpoint',
          messages: restored.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
          })),
        });
        vscode.window.showInformationMessage(`Checkpoint "${selected.label}" restored.`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.checkpoint.delete', async (item) => {
      const sessionId = item?.session?.id || sessionLifecycle.getCurrentSessionId();
      if (!sessionId) {
        vscode.window.showWarningMessage('No active session.');
        return;
      }
      const checkpoints = checkpointManager.listCheckpoints(sessionId);
      if (checkpoints.length === 0) {
        vscode.window.showInformationMessage('No checkpoints to delete.');
        return;
      }
      interface CheckpointPickItem extends vscode.QuickPickItem {
        checkpointId: string;
      }
      const items: CheckpointPickItem[] = checkpoints.map((cp) => ({
        label: cp.label,
        description: `${new Date(cp.createdAt).toLocaleString()}`,
        checkpointId: cp.id,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a checkpoint to delete',
      });
      if (!selected) return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete checkpoint "${selected.label}"?`,
        { modal: true },
        'Delete',
      );
      if (confirm === 'Delete') {
        checkpointManager.deleteCheckpoint(sessionId, selected.checkpointId);
        vscode.window.showInformationMessage('Checkpoint deleted.');
      }
    }),
  );

  // Step 9.10: Start crash recovery
  crashRecoveryAdapter.startAutoSave();
  crashRecoveryAdapter.checkAndOfferRestore();

  // Step 9.11: Initialize Phase 9 components (Secret Sauce & Memory)
  const memoryTreeProvider = new MemoryTreeProvider();
  const diaryTreeProvider = new DiaryTreeProvider();
  const memoryEditor = new MemoryEditor();
  const soulEditor = new SoulEditor();
  const sauceBrowser = new SecretSauceBrowser();
  const memoryNotifier = new MemoryExtractionNotifier();

  context.subscriptions.push(memoryTreeProvider, diaryTreeProvider, memoryEditor, sauceBrowser, memoryNotifier);
  soulEditor.registerSaveHandler(context);

  const memoryTreeView = vscode.window.createTreeView('agentxMemories', {
    treeDataProvider: memoryTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(memoryTreeView);

  const diaryTreeView = vscode.window.createTreeView('agentxDiary', {
    treeDataProvider: diaryTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(diaryTreeView);

  const sauceTreeView = vscode.window.createTreeView('agentxSecretSauce', {
    treeDataProvider: sauceBrowser,
    showCollapseAll: true,
  });
  context.subscriptions.push(sauceTreeView);

  memoryNotifier.setOnMemoryAdded(() => memoryTreeProvider.refresh());

  function updateSauceFromEngine(): void {
    const agent = engineLifecycle.getEngine()?.getAgent();
    if (agent?.sauce) {
      memoryTreeProvider.setSecretSauce(agent.sauce);
      diaryTreeProvider.setSecretSauce(agent.sauce);
      memoryEditor.setSecretSauce(agent.sauce);
      memoryNotifier.setSecretSauce(agent.sauce);
    }
  }

  // Register Phase 9 commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.memory.openEditor', () => memoryEditor.show(context)),
    vscode.commands.registerCommand('agentx.memory.refresh', () => memoryTreeProvider.refresh()),
    vscode.commands.registerCommand('agentx.memory.viewDetail', (memory: import('./providers/MemoryTreeProvider').MemoryEntry) => {
      const date = new Date(memory.timestamp).toLocaleString();
      const content = [
        'Memory Detail',
        `${'─'.repeat(40)}`,
        `ID:       ${memory.id}`,
        `Category: ${memory.category}`,
        `Date:     ${date}`,
        `Relevance: ${memory.relevance}`,
        '',
        'Content:',
        memory.content,
      ].join('\n');
      vscode.workspace.openTextDocument({ content, language: 'plaintext' }).then(
        (doc) => vscode.window.showTextDocument(doc, { preview: true }),
      );
    }),
    vscode.commands.registerCommand('agentx.memory.add', async () => {
      const agent = engineLifecycle.getEngine()?.getAgent();
      if (!agent?.sauce) return;
      const content = await vscode.window.showInputBox({
        prompt: 'Enter memory content',
        placeHolder: 'e.g., User prefers dark mode',
      });
      if (!content) return;
      const category = await vscode.window.showQuickPick(
        ['identity', 'preference', 'project', 'instruction', 'context'],
        { placeHolder: 'Select category' },
      );
      if (!category) return;
      agent.sauce.recordMemory(content, category);
      memoryTreeProvider.refresh();
      vscode.window.showInformationMessage('Memory added.');
    }),
    vscode.commands.registerCommand('agentx.memory.delete', async (item: import('./providers/MemoryTreeProvider').MemoryTreeItem) => {
      if (!item.memory) return;
      const confirmed = await vscode.window.showWarningMessage(
        `Delete memory: "${item.memory.content.slice(0, 50)}..."?`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      const { writeFileSync, readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { getSecretSauceDir } = await import('@agentx/shared');
      const sauceDir = getSecretSauceDir();
      const scope = item.scope ?? 'crew';
      const filePath = scope === 'global'
        ? join(sauceDir, 'global', 'memories.json')
        : join(sauceDir, 'crews', item.scope === 'global' ? '' : (engineLifecycle.getEngine()?.getAgent()?.sauce.crew.getActiveId() ?? 'default'), 'memories.json');
      if (existsSync(filePath)) {
        try {
          const entries = JSON.parse(readFileSync(filePath, 'utf-8')) as import('./providers/MemoryTreeProvider').MemoryEntry[];
          const filtered = entries.filter((e) => e.id !== item.memory!.id);
          writeFileSync(filePath, JSON.stringify(filtered, null, 2));
          memoryTreeProvider.refresh();
          vscode.window.showInformationMessage('Memory deleted.');
        } catch {
          vscode.window.showErrorMessage('Failed to delete memory.');
        }
      }
    }),
    vscode.commands.registerCommand('agentx.memory.search', async () => {
      const agent = engineLifecycle.getEngine()?.getAgent();
      if (!agent?.sauce) return;
      const query = await vscode.window.showInputBox({
        prompt: 'Search memories',
        placeHolder: 'Enter search term...',
      });
      if (!query) return;
      const results = agent.sauce.memories.searchMemories(query);
      if (results.length === 0) {
        vscode.window.showInformationMessage('No memories found.');
        return;
      }
      interface MemoryPickItem extends vscode.QuickPickItem {
        memory: import('./providers/MemoryTreeProvider').MemoryEntry;
      }
      const items: MemoryPickItem[] = results.map((m) => ({
        label: m.content.slice(0, 60),
        description: `[${m.category}] ${new Date(m.timestamp).toLocaleDateString()}`,
        detail: m.content,
        memory: m,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} result(s) — select to view`,
        matchOnDetail: true,
      });
      if (selected) {
        vscode.commands.executeCommand('agentx.memory.viewDetail', selected.memory);
      }
    }),
    vscode.commands.registerCommand('agentx.memory.export', async () => {
      const agent = engineLifecycle.getEngine()?.getAgent();
      if (!agent?.sauce) return;
      const globalMemories = agent.sauce.memories.getGlobalMemories(100);
      const crewMemories = agent.sauce.memories.getCrewMemories(100);
      const exportData = {
        exportedAt: new Date().toISOString(),
        crewName: agent.sauce.crew.getActive()!.name,
        global: globalMemories,
        crew: crewMemories,
        total: globalMemories.length + crewMemories.length,
      };
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`agentx-memories-${Date.now()}.json`),
        filters: { 'JSON Files': ['json'] },
      });
      if (uri) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(uri.fsPath, JSON.stringify(exportData, null, 2));
        vscode.window.showInformationMessage(`Exported ${exportData.total} memories.`);
      }
    }),
    vscode.commands.registerCommand('agentx.diary.refresh', () => diaryTreeProvider.refresh()),
    vscode.commands.registerCommand('agentx.diary.viewEntry', (entry: import('./providers/DiaryTreeProvider').DiaryEntry) => {
      const lines = [
        `Diary Entry — ${entry.date}`,
        `${'═'.repeat(40)}`,
        '',
        `Summary:`,
        entry.summary,
        '',
        `Sessions: ${entry.sessionsCount}`,
      ];
      if (entry.highlights.length > 0) {
        lines.push('', 'Highlights:');
        entry.highlights.forEach((h) => lines.push(`  • ${h}`));
      }
      if (entry.insights.length > 0) {
        lines.push('', 'Insights:');
        entry.insights.forEach((i) => lines.push(`  • ${i}`));
      }
      vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' }).then(
        (doc) => vscode.window.showTextDocument(doc, { preview: true }),
      );
    }),
    vscode.commands.registerCommand('agentx.soul.open', () => soulEditor.openSoul()),
    vscode.commands.registerCommand('agentx.sauce.refresh', () => sauceBrowser.refresh()),
    vscode.commands.registerCommand('agentx.sauce.openFile', (filePath: string) => sauceBrowser.openFile(filePath)),
    vscode.commands.registerCommand('agentx.sauce.openInExplorer', () => sauceBrowser.openInExplorer()),
  );

  // Phase 10: Advanced Features initialization
  const modeStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 60);
  context.subscriptions.push(modeStatusItem);
  const sessionModes = new SessionModes(modeStatusItem);
  context.subscriptions.push(sessionModes);

  const clarificationHandler = new ClarificationHandler();
  eventBridge.onClarification((req) => void clarificationHandler.handle(req));

  const steerHandler = new SteerHandler();

  const ragStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
  context.subscriptions.push(ragStatusItem);
  const ragAdapter = new RAGAdapter(ragStatusItem);
  context.subscriptions.push({ dispose: () => ragAdapter.dispose() });

  const schedulerAdapter = new SchedulerAdapter();
  context.subscriptions.push(schedulerAdapter);
  const remindersTreeView = vscode.window.createTreeView('agentxReminders', {
    treeDataProvider: schedulerAdapter,
    showCollapseAll: true,
  });
  context.subscriptions.push(remindersTreeView);

  const mcpManager = new MCPManager();
  context.subscriptions.push(mcpManager);
  const mcpTreeView = vscode.window.createTreeView('agentxMCPServers', {
    treeDataProvider: mcpManager,
    showCollapseAll: true,
  });
  context.subscriptions.push(mcpTreeView);

  const skillsAdapter = new SkillsAdapter();
  context.subscriptions.push(skillsAdapter);
  const skillsTreeView = vscode.window.createTreeView('agentxSkills', {
    treeDataProvider: skillsAdapter,
    showCollapseAll: true,
  });
  context.subscriptions.push(skillsTreeView);

  // Attach Phase 10 adapters when engine becomes available
  const attachPhase10 = (): void => {
    const engine = engineLifecycle.getEngine()?.getAgent();
    if (!engine) return;
    sessionModes.attach(engine);
    clarificationHandler.attach(engine);
    steerHandler.attach(engine);
    const folders = vscode.workspace.workspaceFolders;
    const root = folders?.[0]?.uri.fsPath;
    if (root) {
      ragAdapter.attach(engine, root);
    }
    const internal = engine as unknown as { scheduler?: import('@agentx/engine').Scheduler; mcpBridge?: import('@agentx/engine').MCPBridge; skillGenerator?: import('@agentx/engine').SkillGenerator; reflectionLoop?: import('@agentx/engine').ReflectionLoop };
    if (internal.scheduler) schedulerAdapter.attach(internal.scheduler);
    if (internal.mcpBridge) mcpManager.attach(internal.mcpBridge);
    if (internal.skillGenerator) skillsAdapter.attach(internal.skillGenerator, internal.reflectionLoop);
  };
  attachPhase10();
  eventBridge.onSessionChange(() => attachPhase10());

  // Register Phase 10 commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.switchMode', () => sessionModes.switchMode()),
    vscode.commands.registerCommand('agentx.session.agentMode', () => sessionModes.setMode('agent')),
    vscode.commands.registerCommand('agentx.session.askMode', () => sessionModes.setMode('ask')),
    vscode.commands.registerCommand('agentx.session.planMode', () => sessionModes.setMode('plan')),
    vscode.commands.registerCommand('agentx.rag.index', async () => {
      const engine = engineLifecycle.getEngine()?.getAgent();
      if (!engine) { vscode.window.showErrorMessage('No agent active.'); return; }
      const folders = vscode.workspace.workspaceFolders;
      const root = folders?.[0]?.uri.fsPath;
      if (!root) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
      ragAdapter.attach(engine, root);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Indexing Workspace', cancellable: false },
        async (progress) => { await ragAdapter.indexWorkspace(progress); },
      );
    }),
    vscode.commands.registerCommand('agentx.rag.reindex', async () => {
      await vscode.commands.executeCommand('agentx.rag.index');
    }),
    vscode.commands.registerCommand('agentx.rag.clear', async () => { await ragAdapter.clearIndex(); }),
    vscode.commands.registerCommand('agentx.rag.search', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search workspace knowledge base',
        placeHolder: 'e.g., how does authentication work?',
      });
      if (!query) return;
      const results = await ragAdapter.search(query);
      if (results.length === 0) { vscode.window.showInformationMessage('No relevant documents found in index.'); return; }
      const items = results.map((r, i) => ({
        label: (r.metadata?.path as string) ?? `Result ${i + 1}`,
        description: r.score != null ? `${Math.round(r.score * 100)}% match` : '',
        detail: r.content.slice(0, 200),
        content: r.content,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} result(s) — select to view`,
        matchOnDetail: true,
      });
      if (selected) {
        const doc = await vscode.workspace.openTextDocument({ content: selected.content, language: 'plaintext' });
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    }),
    vscode.commands.registerCommand('agentx.reminder.add', () => schedulerAdapter.addReminder()),
    vscode.commands.registerCommand('agentx.reminder.remove', (item) => schedulerAdapter.removeReminder(item)),
    vscode.commands.registerCommand('agentx.reminder.toggle', (item) => schedulerAdapter.toggleReminder(item)),
    vscode.commands.registerCommand('agentx.reminder.runNow', (item) => schedulerAdapter.runNow(item)),
    vscode.commands.registerCommand('agentx.reminder.refresh', () => schedulerAdapter.refresh()),
    vscode.commands.registerCommand('agentx.mcp.connect', (name?: string) => mcpManager.connectServer(name)),
    vscode.commands.registerCommand('agentx.mcp.disconnect', (item) => mcpManager.disconnectServer(item)),
    vscode.commands.registerCommand('agentx.mcp.testTool', (s, t) => mcpManager.testTool(s, t)),
    vscode.commands.registerCommand('agentx.mcp.openConfig', () => mcpManager.openConfig()),
    vscode.commands.registerCommand('agentx.mcp.refresh', () => mcpManager.refresh()),
    vscode.commands.registerCommand('agentx.skills.refresh', () => skillsAdapter.refresh()),
    vscode.commands.registerCommand('agentx.skill.viewDetail', (skill) => skillsAdapter.viewDetail(skill)),
    vscode.commands.registerCommand('agentx.skill.delete', (item) => skillsAdapter.deleteSkill(item)),
  );

  // Step 10: Wire EventBridge to update UI components
  eventBridge.onStatusChange((status) => {
    statusBarManager.updateProcessingStatus(status as 'processing' | 'error' | 'idle');
    contextKeyManager.set('agentx.isProcessing', status === 'processing');
  });

  eventBridge.onMessage(() => {
    updateSauceFromEngine();
    memoryNotifier.onMessageReceived();
  });

  eventBridge.onSessionChange(() => {
    sessionTreeProvider.refresh();
    contextKeyManager.set('agentx.hasSession', engineLifecycle.hasActiveSession());
    statusBarManager.updateSessionIndicator(engineLifecycle.getCurrentSessionId());
    // Phase 9: Update secret sauce engine data when session changes
    updateSauceFromEngine();
  });

  eventBridge.onTokenUsage((usage) => {
    statusBarManager.updateTokenUsage(usage);
  });

  eventBridge.onProviderChange((provider) => {
    statusBarManager.updateProviderIndicator(provider);
  });

  eventBridge.onModelChange((model) => {
    statusBarManager.updateModelIndicator(model);
  });

  eventBridge.onPlanModeChange((active) => {
    statusBarManager.updatePlanModeIndicator(active);
    contextKeyManager.set('agentx.planMode', active);
  });

  eventBridge.onPermissionRequest(() => {
    contextKeyManager.set('agentx.hasPermissionRequest', true);
  });

  eventBridge.onPermissionResolved(() => {
    contextKeyManager.set('agentx.hasPermissionRequest', false);
  });

  // Step 11: Configuration change listener
  const configWatcher = new ConfigurationWatcher(configBridge, engineLifecycle, statusBarManager);
  context.subscriptions.push(configWatcher);

  // Step 12: Workspace folder change listener
  const workspaceWatcher = new WorkspaceWatcher(engineLifecycle, statusBarManager, chatViewProvider);
  context.subscriptions.push(workspaceWatcher);

  // Step 13: File system watcher for config.json
  const configFileWatcher = new ConfigFileWatcher(configBridge, statusBarManager, engineLifecycle);
  context.subscriptions.push(configFileWatcher);

  // Step 14: Set initial status bar state
  const config = configBridge.getConfig();
  if (config) {
    statusBarManager.initializeFromConfig(config as unknown as Record<string, unknown>);
  }
  statusBarManager.updateCrewIndicator(configBridge.getActiveCrewName());

  outputChannel.appendLine('[Agent-X] Extension activated successfully.');
}

export async function deactivate(): Promise<void> {
  disposeDiagnostics();

  if (extensionContext) {
    const ctx = extensionContext;
    for (let i = ctx.subscriptions.length - 1; i >= 0; i--) {
      const d = ctx.subscriptions[i];
      if (d) {
        try {
          d.dispose();
        } catch {
        }
      }
    }
  }

  if (engineLifecycle) {
    await engineLifecycle.dispose();
  }
  if (statusBarManager) {
    statusBarManager.dispose();
  }
  if (contextKeyManager) {
    contextKeyManager.dispose();
  }
  if (eventBridge) {
    eventBridge.dispose();
  }
  if (configBridge) {
    configBridge.dispose();
  }

  if (extensionContext) {
    deleteEngineInstance(extensionContext);
  }
}
