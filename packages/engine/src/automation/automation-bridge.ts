import type { AutomationNotifyChannel, AutomationRegisterInput, AutomationTaskRecord } from '@agentx/shared';

export interface AutomationBridge {
  ensureToolsApproved(
    sessionId: string,
    toolIds: string[],
  ): Promise<{ ok: boolean; denied?: string[]; error?: string }>;
  promptNotifyChannels(sessionId: string): Promise<AutomationNotifyChannel[]>;
  grantNotifyChannelTools(sessionId: string, channels: AutomationNotifyChannel[]): Promise<void>;
  registerTask(input: AutomationRegisterInput): Promise<{ ok: boolean; taskId?: string; displayId?: string; error?: string }>;
  listTasks(sessionId?: string): Promise<AutomationTaskRecord[]>;
  cancelTask(idOrKey: string, sessionId?: string): Promise<{ ok: boolean; error?: string }>;
}

let bridge: AutomationBridge | null = null;

export function setAutomationBridge(instance: AutomationBridge | null): void {
  bridge = instance;
}

export function getAutomationBridge(): AutomationBridge | null {
  return bridge;
}
