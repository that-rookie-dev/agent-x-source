export type AgentXOverviewView =
  | 'summary'
  | 'sessions'
  | 'automations'
  | 'notifications'
  | 'settings'
  | 'session_detail';

export interface AgentXOverviewBridge {
  getOverview(view: AgentXOverviewView, sessionId?: string): Promise<string>;
  getActiveSessionId(): string | null;
}

let bridge: AgentXOverviewBridge | null = null;

export function setAgentXOverviewBridge(instance: AgentXOverviewBridge | null): void {
  bridge = instance;
}

export function getAgentXOverviewBridge(): AgentXOverviewBridge | null {
  return bridge;
}
