export type Notification = {
  id: number;
  type: 'error' | 'warning' | 'escalation' | 'checkpoint' | 'automation';
  message: string;
  timestamp: number;
  read: boolean;
  onClick?: () => void;
  /** Suppress the on-screen toast when quiet hours / DND is active. */
  skipToast?: boolean;
};

let notifications: Notification[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

let quietStartHour: number | null = null;
let quietEndHour: number | null = null;

function emit() {
  for (const l of listeners) l();
}

function isWithinQuietHours(): boolean {
  if (quietStartHour == null || quietEndHour == null) return false;
  if (quietStartHour < 0 || quietEndHour < 0) return false;

  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;

  if (quietStartHour === quietEndHour) return false;

  if (quietStartHour < quietEndHour) {
    return hour >= quietStartHour && hour < quietEndHour;
  }

  // Crosses midnight (e.g. 22:00 - 08:00)
  return hour >= quietStartHour || hour < quietEndHour;
}

export function isQuiet(): boolean {
  return isWithinQuietHours();
}

export function setQuietHours(startHour: number, endHour: number): void {
  quietStartHour = startHour >= 0 ? startHour : null;
  quietEndHour = endHour >= 0 ? endHour : null;
}

export function getQuietHours(): { startHour: number | null; endHour: number | null } {
  return { startHour: quietStartHour, endHour: quietEndHour };
}

export function notify(
  type: Notification['type'],
  message: string,
  opts?: { persist?: boolean; onClick?: () => void },
) {
  const id = nextId++;
  const quiet = isQuiet();
  const persist = quiet ? true : opts?.persist;

  const note: Notification = {
    id,
    type,
    message,
    timestamp: Date.now(),
    read: false,
    onClick: opts?.onClick,
    skipToast: quiet,
  };

  notifications = [...notifications, note].slice(-100);
  emit();

  if (!persist) {
    setTimeout(() => {
      notifications = notifications.filter((n) => n.id !== id);
      emit();
    }, 8000);
  }
}

export function getNotifications(): Notification[] {
  return [...notifications];
}

export function markAllRead(): void {
  notifications = notifications.map((n) => ({ ...n, read: true }));
  emit();
}

export function clearNotifications(): void {
  notifications = [];
  emit();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
