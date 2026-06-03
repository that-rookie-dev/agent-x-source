import * as vscode from 'vscode';
import { EngineLifecycle } from '../adapter/EngineLifecycle';
import { ConfigBridge } from '../adapter/ConfigBridge';
import { EventBridge } from '../adapter/EventBridge';
import { StatusBarManager } from '../statusbar/StatusBarManager';
import { ContextKeyManager } from '../context/ContextKeyManager';

import { openChatHandler } from './session/openChat';
import { newSessionHandler } from './session/newSession';
import { restoreSessionHandler } from './session/restoreSession';
import { deleteSessionHandler } from './session/deleteSession';
import { exportSessionHandler } from './session/exportSession';
import { clearHistoryHandler } from './session/clearHistory';
import { compactSessionHandler } from './session/compactSession';
import { searchSessionsHandler } from './session/searchSessions';

import { showModelPicker } from './ModelPicker';
import { showProviderPicker } from './ProviderPicker';
import { showProviderConfig } from './ProviderConfig';

import { showCrewPicker } from './CrewPicker';
import { showCrewCreator } from './CrewCreator';
import { showCrewEditor } from './CrewEditor';

import { cancelTaskHandler } from './agent/cancelTask';
import { sendSteerMessageHandler } from './agent/sendSteerMessage';
import { togglePlanModeHandler } from './agent/togglePlanMode';
import { showPermissionsHandler } from './agent/showPermissions';

import { showCostHandler } from './utility/showCost';
import { openConfigHandler } from './utility/openConfig';
import { openSecretSauceHandler } from './utility/openSecretSauce';
import { showAboutHandler } from './utility/showAbout';

export interface CommandDeps {
  engineLifecycle: EngineLifecycle;
  configBridge: ConfigBridge;
  eventBridge: EventBridge;
  statusBarManager: StatusBarManager;
  contextKeyManager: ContextKeyManager;
  outputChannel: vscode.OutputChannel;
}

export function registerAllCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const commands: Array<[string, (...args: unknown[]) => unknown]> = [
    // Session commands
    ['agentx.openChat', openChatHandler(deps)],
    ['agentx.newSession', newSessionHandler(deps)],
    ['agentx.restoreSession', restoreSessionHandler(deps)],
    ['agentx.deleteSession', deleteSessionHandler(deps)],
    ['agentx.exportSession', exportSessionHandler(deps)],
    ['agentx.clearHistory', clearHistoryHandler(deps)],
    ['agentx.compactSession', compactSessionHandler(deps)],
    ['agentx.searchSessions', searchSessionsHandler(deps)],

    // Model/Provider commands
    ['agentx.switchModel', showModelPicker(deps)],
    ['agentx.switchProvider', showProviderPicker(deps)],
    ['agentx.configureProvider', (...args: unknown[]) => showProviderConfig(deps)(args[0] as string | undefined)],

    // Crew/Profile commands
    ['agentx.switchCrew', showCrewPicker(deps)],
    ['agentx.createCrew', showCrewCreator(deps)],
    ['agentx.editCrew', showCrewEditor(deps)],

    // Agent commands
    ['agentx.cancelTask', cancelTaskHandler(deps)],
    ['agentx.sendSteerMessage', sendSteerMessageHandler(deps)],
    ['agentx.togglePlanMode', togglePlanModeHandler(deps)],
    ['agentx.showPermissions', showPermissionsHandler(deps)],

    // Utility commands
    ['agentx.showCost', showCostHandler(deps)],
    ['agentx.openConfig', openConfigHandler(deps)],
    ['agentx.openSecretSauce', openSecretSauceHandler(deps)],
    ['agentx.showAbout', showAboutHandler(deps)],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
}
