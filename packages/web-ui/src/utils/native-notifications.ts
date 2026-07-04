import type { NotificationRecord } from '../api';
import { sanitizeAutomationNotificationBody } from '@agentx/shared/browser';

const APP_TITLE = 'Agent-X';

function plainTextSummary(notification: NotificationRecord): string {
  const title = notification.title.replace(/^[✓✗]\s*/, '');
  return sanitizeAutomationNotificationBody(notification.body, { title })
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Request browser notification permission (non-Electron). */
export async function requestBrowserNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

function shouldShowOsAlert(notification: NotificationRecord): boolean {
  if (notification.kind === 'automation_scheduled') return false;
  const channels = notification.channels ?? [];
  if (channels.length === 0) return true;
  return channels.some((c) => c === 'in_app' || c === 'desktop');
}

/** Show a branded OS notification from Agent-X (Electron or Web Notifications API). */
export async function showAgentXNotification(notification: NotificationRecord): Promise<void> {
  if (!shouldShowOsAlert(notification)) return;

  const subtitle = notification.title.replace(/^[✓✗]\s*/, '');
  const body = plainTextSummary(notification).slice(0, 500);

  if (window.agentx?.isDesktop && window.agentx.showNotification) {
    await window.agentx.showNotification({
      title: APP_TITLE,
      subtitle,
      body,
    });
    return;
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const text = subtitle ? `${subtitle}\n${body}` : body;
    new Notification(APP_TITLE, { body: text.slice(0, 500), icon: '/logo.png' });
  }
}
