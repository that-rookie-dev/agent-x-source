import {
  getNotificationChannelStatus,
  setAgentXOverviewBridge,
  setChannelSuperSessionSync,
  type AgentXOverviewView,
} from '@agentx/engine';
import {
  isUserFacingSession,
  isChannelSessionId,
  type AgentXConfig,
} from '@agentx/shared';
import { getEngine, syncChannelSuperSessionContext } from './engine.js';
import { getTelegramRuntimeHints } from './channels-sync.js';
import { getAutomationService } from './automation/index.js';
import { getActiveWorkspacePath } from './workspace.js';

function formatSessionLine(s: Record<string, unknown>): string {
  const id = String(s['id'] ?? '');
  const title = String(s['title'] ?? s['name'] ?? id.slice(0, 8));
  const kind = String(s['contextKind'] ?? 'agent_x');
  const updated = s['updatedAt'] ? new Date(String(s['updatedAt'])).toLocaleString() : '—';
  const msgCount = s['messageCount'] ?? s['message_count'];
  const countSuffix = msgCount != null ? ` | ${msgCount} msgs` : '';
  return `- [${kind}] ${title} (${id.slice(0, 12)}…)${countSuffix} | updated ${updated}`;
}

function resolveActiveSessionId(eng: ReturnType<typeof getEngine>): string | null {
  const active = eng.sessionManager.getActiveSession();
  if (active?.id) return active.id;
  const main = eng.agent;
  if (main?.currentSessionId && !isChannelSessionId(main.currentSessionId)) {
    return main.currentSessionId;
  }
  return null;
}

function listUserSessions(eng: ReturnType<typeof getEngine>): Array<Record<string, unknown>> {
  const listFn = (eng.sessionManager as { listRootSessions?: (n: number) => unknown[] }).listRootSessions;
  const all = (listFn
    ? listFn.call(eng.sessionManager, 100)
    : eng.sessionManager.listSessions(100)) as Array<Record<string, unknown>>;
  return all.filter((s) => isUserFacingSession({
    id: String(s['id'] ?? ''),
    parentId: (s['parentId'] as string | null | undefined) ?? null,
    contextKind: (s['contextKind'] as string | undefined) ?? 'agent_x',
  }));
}

async function buildSummary(eng: ReturnType<typeof getEngine>): Promise<string> {
  const lines: string[] = ['Agent-X fleet snapshot'];
  const activeId = resolveActiveSessionId(eng);
  const active = activeId ? eng.sessionManager.getSessionById(activeId) : null;
  lines.push('');
  lines.push(`Active UI session: ${active?.title ?? activeId ?? '(none)'}`);
  try {
    lines.push(`Workspace: ${getActiveWorkspacePath()}`);
  } catch { /* best-effort */ }
  lines.push(`Channel session: __channel__ (this messaging channel)`);

  const sessions = listUserSessions(eng);
  const crewPrivate = sessions.filter((s) => (s['contextKind'] ?? 'agent_x') === 'crew_private');
  lines.push('');
  lines.push(`Sessions: ${sessions.length} user-facing (${crewPrivate.length} crew-private)`);

  const svc = getAutomationService();
  const automations = svc ? await svc.listTasks() : [];
  const activeAuto = automations.filter((t) => t.status === 'active' || t.status === 'paused');
  lines.push(`Automations: ${automations.length} total (${activeAuto.length} active/paused)`);

  if (svc) {
    const unread = await svc.unreadCount();
    lines.push(`Notifications: ${unread} unread`);
  }

  const cfg = eng.configManager.load() as AgentXConfig;
  lines.push('');
  lines.push(`Provider: ${cfg.provider.activeProvider ?? '—'} / ${cfg.provider.activeModel ?? '—'}`);
  const channelStatus = getNotificationChannelStatus(cfg, getTelegramRuntimeHints());
  const configuredChannels = Object.entries(channelStatus)
    .filter(([, v]) => v.configured)
    .map(([k]) => k);
  lines.push(`Notification channels configured: ${configuredChannels.length ? configuredChannels.join(', ') : 'none'}`);

  if (automations.length > 0) {
    lines.push('');
    lines.push('Recent automations:');
    for (const t of automations.slice(0, 5)) {
      const when = t.scheduleType === 'once'
        ? (t.runAt ? new Date(t.runAt).toLocaleString() : '—')
        : (t.cronExpression ?? '—');
      lines.push(`- [${t.status}] ${t.title} (${t.displayId ?? t.id}) | ${when}${t.lastRunStatus ? ` | last: ${t.lastRunStatus}` : ''}`);
    }
  }

  return lines.join('\n');
}

async function buildSessionsView(eng: ReturnType<typeof getEngine>): Promise<string> {
  const sessions = listUserSessions(eng);
  const store = (eng.sessionManager as unknown as { store?: { getMessageCount?: (id: string) => number } }).store;
  const activeId = resolveActiveSessionId(eng);
  const lines = [`User-facing sessions (${sessions.length}):`];
  for (const s of sessions) {
    const id = String(s['id'] ?? '');
    const enriched = { ...s };
    if (store?.getMessageCount) {
      try { enriched['messageCount'] = store.getMessageCount(id); } catch { /* ignore */ }
    }
    const marker = id === activeId ? ' ← active UI' : '';
    lines.push(`${formatSessionLine(enriched)}${marker}`);
  }
  return lines.join('\n');
}

async function buildAutomationsView(): Promise<string> {
  const svc = getAutomationService();
  if (!svc) return 'Automation service not available.';
  const tasks = await svc.listTasks();
  if (tasks.length === 0) return 'No automations registered.';
  const lines = [`Automations (${tasks.length}):`];
  for (const t of tasks) {
    const when = t.scheduleType === 'once'
      ? (t.runAt ? new Date(t.runAt).toLocaleString() : '—')
      : (t.cronExpression ?? '—');
    const src = t.sourceSessionId ? ` | from session ${t.sourceSessionId.slice(0, 12)}…` : '';
    lines.push(`- [${t.status}] ${t.title} | ${t.displayId ?? t.id} | ${t.scheduleType} ${when}${src}${t.lastRunStatus ? ` | last run: ${t.lastRunStatus}` : ''}`);
  }
  return lines.join('\n');
}

async function buildNotificationsView(): Promise<string> {
  const svc = getAutomationService();
  if (!svc) return 'Notification service not available.';
  const [notifications, unread] = await Promise.all([
    svc.listNotifications(15, false),
    svc.unreadCount(),
  ]);
  const lines = [`Notifications (${unread} unread):`];
  if (notifications.length === 0) {
    lines.push('(none)');
    return lines.join('\n');
  }
  for (const n of notifications) {
    const read = n.readAt ? 'read' : 'unread';
    lines.push(`- [${read}] ${n.title} | ${n.kind} | ${new Date(n.createdAt).toLocaleString()}`);
  }
  return lines.join('\n');
}

function buildSettingsView(eng: ReturnType<typeof getEngine>): string {
  const cfg = eng.configManager.load() as AgentXConfig;
  const lines = ['Settings summary (no secrets):'];
  lines.push(`Provider: ${cfg.provider.activeProvider ?? '—'}`);
  lines.push(`Model: ${cfg.provider.activeModel ?? '—'}`);
  lines.push(`Sandbox: ${cfg.useSandbox ? 'enabled' : 'disabled'}`);
  lines.push(`User callsign: ${cfg.user?.callsign ?? '(not set)'}`);

  const channelStatus = getNotificationChannelStatus(cfg, getTelegramRuntimeHints());
  lines.push('');
  lines.push('Notification channels:');
  for (const [channel, status] of Object.entries(channelStatus)) {
    lines.push(`- ${channel}: ${status.configured ? 'configured' : 'not configured'}${status.enabled ? '' : ' (disabled)'}`);
  }

  const installed = eng.pluginRegistry.getInstalled?.() ?? [];
  if (installed.length > 0) {
    lines.push('');
    lines.push('Installed plugins:');
    for (const p of installed) {
      lines.push(`- ${p.id}: ${p.enabled ? 'enabled' : 'disabled'}`);
    }
  }

  return lines.join('\n');
}

async function buildSessionDetail(eng: ReturnType<typeof getEngine>, sessionId: string): Promise<string> {
  const session = eng.sessionManager.getSessionById(sessionId);
  if (!session) return `Session not found: ${sessionId}`;

  let workspaceLine = 'Workspace: —';
  try {
    workspaceLine = `Workspace: ${getActiveWorkspacePath()}`;
  } catch { /* best-effort */ }
  const lines = [
    `Session: ${session.title ?? session.id}`,
    `ID: ${session.id}`,
    `Kind: ${session.contextKind ?? 'agent_x'}`,
    workspaceLine,
    `Updated: ${session.updatedAt ?? '—'}`,
  ];

  const crewStates = eng.sessionManager.loadCrewStates(session.id);
  if (crewStates.length > 0) {
    const enabled = crewStates.filter((c) => c.enabled).map((c) => c.crewId);
    lines.push(`Enabled crew: ${enabled.length ? enabled.join(', ') : 'none'}`);
  }

  const store = (eng.sessionManager as unknown as {
    store?: { getMessages?: (id: string) => Array<{ role: string; content: string }> };
  }).store;
  if (store?.getMessages) {
    try {
      const msgs = store.getMessages(session.id).filter((m) =>
        m.role === 'user' || m.role === 'assistant',
      );
      const recent = msgs.slice(-6);
      if (recent.length > 0) {
        lines.push('');
        lines.push('Recent messages:');
        for (const m of recent) {
          const text = (m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
          lines.push(`- ${m.role}: ${text}${m.content.length > 160 ? '…' : ''}`);
        }
      }
    } catch { /* ignore */ }
  }

  const svc = getAutomationService();
  if (svc) {
    const tasks = await svc.listTasks(session.id);
    if (tasks.length > 0) {
      lines.push('');
      lines.push(`Automations from this session (${tasks.length}):`);
      for (const t of tasks.slice(0, 8)) {
        lines.push(`- [${t.status}] ${t.title} (${t.displayId ?? t.id})`);
      }
    }
  }

  return lines.join('\n');
}

export function initAgentXOverviewBridge(): void {
  setChannelSuperSessionSync(() => syncChannelSuperSessionContext());
  setAgentXOverviewBridge({
    getActiveSessionId: () => resolveActiveSessionId(getEngine()),
    getOverview: async (view: AgentXOverviewView, sessionId?: string) => {
      const eng = getEngine();
      switch (view) {
        case 'summary':
          return buildSummary(eng);
        case 'sessions':
          return buildSessionsView(eng);
        case 'automations':
          return buildAutomationsView();
        case 'notifications':
          return buildNotificationsView();
        case 'settings':
          return buildSettingsView(eng);
        case 'session_detail':
          return buildSessionDetail(eng, sessionId ?? '');
        default:
          return buildSummary(eng);
      }
    },
  });
}

export function shutdownAgentXOverviewBridge(): void {
  setChannelSuperSessionSync(null);
  setAgentXOverviewBridge(null);
}
