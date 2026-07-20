import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IntegrationNotification, IntegrationNotificationKind } from '@agentx/shared';
import { getDataDir } from '@agentx/shared';

interface PersistedNotifications {
  notifications: IntegrationNotification[];
}

const MAX_NOTIFICATIONS = 200;

export class IntegrationNotificationStore {
  private readonly dir: string;
  private readonly filePath: string;
  private data: PersistedNotifications = { notifications: [] };

  constructor(baseDir?: string) {
    this.dir = join(baseDir ?? getDataDir(), 'integrations');
    this.filePath = join(this.dir, 'notifications.json');
    this.load();
  }

  list(opts?: { includeDismissed?: boolean; limit?: number }): IntegrationNotification[] {
    const includeDismissed = opts?.includeDismissed === true;
    const limit = opts?.limit ?? 100;
    const items = this.data.notifications
      .filter((n) => includeDismissed || !n.dismissedAt)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items.slice(0, limit);
  }

  activeCount(): number {
    return this.data.notifications.filter((n) => !n.dismissedAt).length;
  }

  add(input: {
    connectionId: string;
    providerId: string;
    displayName: string;
    toolName?: string;
    kind: IntegrationNotificationKind;
    message: string;
    source: IntegrationNotification['source'];
  }): IntegrationNotification {
    // Dedupe same connection+tool+message within 10 minutes.
    const recentCutoff = Date.now() - 10 * 60 * 1000;
    const existing = this.data.notifications.find((n) =>
      !n.dismissedAt
      && n.connectionId === input.connectionId
      && (n.toolName ?? '') === (input.toolName ?? '')
      && n.message === input.message
      && new Date(n.createdAt).getTime() >= recentCutoff,
    );
    if (existing) return existing;

    const entry: IntegrationNotification = {
      id: randomUUID(),
      connectionId: input.connectionId,
      providerId: input.providerId,
      displayName: input.displayName,
      toolName: input.toolName,
      kind: input.kind,
      message: input.message,
      createdAt: new Date().toISOString(),
      source: input.source,
    };
    this.data.notifications.unshift(entry);
    if (this.data.notifications.length > MAX_NOTIFICATIONS) {
      this.data.notifications = this.data.notifications.slice(0, MAX_NOTIFICATIONS);
    }
    this.save();
    return entry;
  }

  dismiss(id: string): boolean {
    const idx = this.data.notifications.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    const current = this.data.notifications[idx]!;
    if (current.dismissedAt) return true;
    this.data.notifications[idx] = { ...current, dismissedAt: new Date().toISOString() };
    this.save();
    return true;
  }

  dismissAll(): number {
    let count = 0;
    const now = new Date().toISOString();
    this.data.notifications = this.data.notifications.map((n) => {
      if (n.dismissedAt) return n;
      count += 1;
      return { ...n, dismissedAt: now };
    });
    if (count > 0) this.save();
    return count;
  }

  clearForConnection(connectionId: string): void {
    const before = this.data.notifications.length;
    this.data.notifications = this.data.notifications.filter((n) => n.connectionId !== connectionId);
    if (this.data.notifications.length !== before) this.save();
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as PersistedNotifications;
      if (Array.isArray(parsed.notifications)) {
        this.data.notifications = parsed.notifications;
      }
    } catch {
      this.data = { notifications: [] };
    }
  }

  private save(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
}
