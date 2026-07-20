import { useState, useEffect, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import CloseIcon from '@mui/icons-material/Close';
import { sanitizeAutomationNotificationBody } from '@agentx/shared/browser';
import { PanelHeader } from './PanelHeader';
import { CrewAwareMarkdown } from '../chat/ChatMarkdown';
import { notifications, type NotificationRecord } from '../api';
import { notify } from './NotificationToast';
import { useAppLive } from '../store/AppContext';
import { colors } from '../theme';

type Filter = 'all' | 'unread';

const bw = {
  bg: colors.bg.primary,
  panel: colors.bg.secondary,
  card: colors.bg.tertiary,
  cardUnread: colors.bg.hover,
  border: colors.border.default,
  text: colors.text.primary,
  muted: colors.text.secondary,
  dim: colors.text.dim,
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function kindLabel(kind: NotificationRecord['kind']): string {
  switch (kind) {
    case 'automation_success': return 'Success';
    case 'automation_failure': return 'Failed';
    case 'automation_scheduled': return 'Scheduled';
    case 'background_task_complete': return 'Background Task';
    case 'background_task_failed': return 'Background Failed';
    default: return kind;
  }
}

function displayBody(n: NotificationRecord): string {
  const title = n.title.replace(/^[✓✗]\s*/, '');
  return sanitizeAutomationNotificationBody(n.body, { title });
}

function NotificationCard({
  notification: n,
  onRead,
  onDismiss,
}: {
  notification: NotificationRecord;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const unread = !n.readAt;
  const isFailure = n.kind === 'automation_failure' || n.kind === 'background_task_failed';
  const body = useMemo(() => displayBody(n), [n]);

  return (
    <Box
      sx={{
        mb: 1,
        p: 1.5,
        borderRadius: 1,
        bgcolor: unread ? bw.cardUnread : bw.card,
        border: `1px solid ${unread ? colors.border.default : bw.border}`,
        opacity: unread ? 1 : 0.85,
        '&:hover': { borderColor: colors.border.strong },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        {isFailure
          ? <ErrorOutlineIcon sx={{ fontSize: 16, color: colors.accent.red, mt: 0.2, flexShrink: 0 }} />
          : <CheckCircleOutlineIcon sx={{ fontSize: 16, color: unread ? colors.text.primary : bw.dim, mt: 0.2, flexShrink: 0 }} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.5, alignItems: 'flex-start' }}>
            <Typography sx={{
              color: bw.text,
              fontSize: '0.72rem',
              fontWeight: unread ? 600 : 500,
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1.35,
            }}>
              {n.title}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
              <Typography sx={{ color: bw.dim, fontSize: '0.58rem', fontFamily: "'JetBrains Mono', monospace" }}>
                {formatWhen(n.createdAt)}
              </Typography>
              <Tooltip title="Clear notification">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
                  sx={{ color: bw.dim, p: 0.25, '&:hover': { color: bw.text } }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          <Box
            onClick={() => { if (unread) onRead(n.id); }}
            sx={{ cursor: unread ? 'pointer' : 'default' }}
          >
            {body ? (
              <Box sx={{
                color: bw.muted,
                fontSize: '0.8125rem',
                lineHeight: 1.55,
                '& a': { color: colors.accent.blue },
              }}>
                <CrewAwareMarkdown content={body} />
              </Box>
            ) : (
              <Typography sx={{ color: bw.dim, fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace" }}>
                (No summary)
              </Typography>
            )}
          </Box>

          <Typography sx={{ color: bw.dim, fontSize: '0.55rem', mt: 0.75, fontFamily: "'JetBrains Mono', monospace" }}>
            {kindLabel(n.kind)}
            {unread ? ' · unread' : ' · read'}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export function NotificationsPanel() {
  const { events, unreadNotificationCount, refreshUnreadNotificationCount } = useAppLive();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { notifications: list } = await notifications.list({
        unread: filter === 'unread',
        limit: 100,
      });
      setItems(list);
      await refreshUnreadNotificationCount();
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter, refreshUnreadNotificationCount]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const last = events[events.length - 1];
    if (last?.type === 'notification_created') void load();
  }, [events, load]);

  const markRead = async (id: string) => {
    try {
      await notifications.markRead(id);
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      await refreshUnreadNotificationCount();
    } catch { /* ignore */ }
  };

  const dismissOne = async (id: string) => {
    try {
      await notifications.dismiss(id);
      setItems((prev) => prev.filter((n) => n.id !== id));
      await refreshUnreadNotificationCount();
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    const unread = items.filter((n) => !n.readAt);
    await Promise.all(unread.map((n) => notifications.markRead(n.id).catch(() => {})));
    await load();
  };

  const clearAll = async () => {
    if (items.length === 0) {
      notify('checkpoint', 'All clear');
      return;
    }
    try {
      await notifications.dismissAll();
      setItems([]);
      await refreshUnreadNotificationCount();
    } catch { /* ignore */ }
  };

  const filtered = filter === 'unread' ? items.filter((n) => !n.readAt) : items;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: bw.bg }}>
      <PanelHeader
        title="Notifications"
        subtitle={`${unreadNotificationCount} unread`}
        icon={<NotificationsNoneIcon sx={{ fontSize: 18 }} />}
        action={(
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {(['all', 'unread'] as Filter[]).map((f) => (
              <Button
                key={f}
                size="small"
                onClick={() => setFilter(f)}
                sx={{
                  minWidth: 56,
                  fontSize: '0.62rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: filter === f ? bw.text : bw.dim,
                  borderColor: filter === f ? bw.border : 'transparent',
                  border: `1px solid ${filter === f ? bw.border : 'transparent'}`,
                  bgcolor: filter === f ? bw.card : 'transparent',
                  '&:hover': { bgcolor: bw.card, borderColor: bw.border },
                }}
              >
                {f === 'all' ? 'All' : 'Unread'}
              </Button>
            ))}
            {unreadNotificationCount > 0 && (
              <Button
                size="small"
                onClick={() => void markAllRead()}
                sx={{
                  fontSize: '0.62rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: bw.muted,
                  '&:hover': { color: bw.text },
                }}
              >
                Mark all read
              </Button>
            )}
            <Button
              size="small"
              onClick={() => void clearAll()}
              sx={{
                fontSize: '0.62rem',
                fontFamily: "'JetBrains Mono', monospace",
                color: bw.muted,
                '&:hover': { color: colors.accent.red },
              }}
            >
              Clear all
            </Button>
          </Box>
        )}
      />

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={24} sx={{ color: bw.muted }} />
          </Box>
        )}

        {!loading && filtered.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <NotificationsNoneIcon sx={{ fontSize: 32, color: bw.dim, mb: 1.5 }} />
            <Typography sx={{ color: bw.muted, fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace" }}>
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </Typography>
            <Typography sx={{ color: bw.dim, fontSize: '0.65rem', mt: 0.5 }}>
              Automation alerts appear here when you choose Notification tray.
            </Typography>
          </Box>
        )}

        {!loading && filtered.map((n) => (
          <NotificationCard
            key={n.id}
            notification={n}
            onRead={(id) => void markRead(id)}
            onDismiss={(id) => void dismissOne(id)}
          />
        ))}
      </Box>
    </Box>
  );
}
