import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ChatIcon from '@mui/icons-material/Chat';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import { IconSparkles, tablerNavProps } from '../icons/tabler';
// Hidden until wired — see source/MILESTONE.md
// import ExtensionIcon from '@mui/icons-material/Extension';
import ExtensionIcon from '@mui/icons-material/Extension';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SettingsIcon from '@mui/icons-material/Settings';
import GroupsIcon from '@mui/icons-material/Groups';
// import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LogoutIcon from '@mui/icons-material/Logout';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ContrastIcon from '@mui/icons-material/Contrast';
import Badge from '@mui/material/Badge';
import { useColorScheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { auth, setAuthToken } from '../api';
import { invalidateApiCache, invalidateCoreSessionCache } from '../perf/api-cache';
import { useAppCore } from '../store/AppContext';
import { colors } from '../theme';
import { layout } from '../styles/layout';
import type { PanelId } from '../pages/Console';

interface Props {
  active: PanelId;
  onNavigate: (id: PanelId) => void;
  highlightCrews?: boolean;
  unreadNotificationCount?: number;
}

const NAV_ITEMS: { id: PanelId; icon: ReactNode; label: string }[] = [
  { id: 'dashboard', icon: <DashboardIcon sx={{ fontSize: 16 }} />, label: 'Dashboard' },
  { id: 'agent-x', icon: <IconSparkles {...tablerNavProps} />, label: 'Agent-X' },
  { id: 'chat', icon: <ChatIcon sx={{ fontSize: 16 }} />, label: 'Chat' },
  { id: 'calls', icon: <PhoneInTalkIcon sx={{ fontSize: 16 }} />, label: 'Calls' },
  { id: 'notifications', icon: <NotificationsNoneIcon sx={{ fontSize: 16 }} />, label: 'Notifications' },
  { id: 'markdown', icon: <ArticleOutlinedIcon sx={{ fontSize: 16 }} />, label: 'Markdown' },
  { id: 'automation', icon: <ScheduleIcon sx={{ fontSize: 16 }} />, label: 'Automation' },
  { id: 'crews', icon: <GroupsIcon sx={{ fontSize: 16 }} />, label: 'Crews' },
  { id: 'knowledge-base', icon: <LibraryBooksIcon sx={{ fontSize: 16 }} />, label: 'Knowledge Base' },
  { id: 'mcp-store', icon: <ExtensionIcon sx={{ fontSize: 16 }} />, label: 'MCP Store' },
  { id: 'settings', icon: <SettingsIcon sx={{ fontSize: 16 }} />, label: 'Settings' },
  // { id: 'plugins', icon: ExtensionIcon, label: 'Plugins' },
];

const MODE_CYCLE = ['dark', 'light', 'system'] as const;

export function Sidebar({ active, onNavigate, highlightCrews, unreadNotificationCount = 0 }: Props) {
  const { setAuthenticated } = useAppCore();
  const navigate = useNavigate();
  const { mode, setMode } = useColorScheme();

  const currentMode = mode ?? 'dark';
  const cycleMode = () => {
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(currentMode as typeof MODE_CYCLE[number]) + 1) % MODE_CYCLE.length]!;
    setMode(next);
  };
  const modeIcon = currentMode === 'light'
    ? <LightModeOutlinedIcon sx={{ fontSize: 14 }} />
    : currentMode === 'system'
      ? <ContrastIcon sx={{ fontSize: 14 }} />
      : <DarkModeOutlinedIcon sx={{ fontSize: 14 }} />;
  const modeLabel = `Theme: ${currentMode}`;

  const handleLogout = async () => {
    try { await auth.logout(); } catch { /* ignore */ }
    setAuthToken(null);
    invalidateApiCache();
    invalidateCoreSessionCache();
    setAuthenticated(false);
    navigate('/login');
  };

  return (
    <Box sx={{
      width: layout.sidebarWidth, minWidth: layout.sidebarWidth, height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', py: 1, borderRight: `1px solid ${colors.border.default}`,
      bgcolor: colors.bg.secondary,
    }}>
      {/* Brand mark */}
      <Tooltip title="@agentx" placement="right">
        <Box sx={{ mb: 1.5, cursor: 'default' }}>
          <img src="/logo.png" alt="Agent-X" style={{ width: 22, height: 22, objectFit: 'contain' }} />
        </Box>
      </Tooltip>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => (
        <Tooltip key={item.id} title={item.label} placement="right">
          <IconButton
            onClick={() => onNavigate(item.id)}
            sx={{
              mb: 0.25, width: 32, height: 32, borderRadius: 1,
              color: (active === item.id || (highlightCrews && item.id === 'crews')) ? colors.text.primary : colors.text.dim,
              bgcolor: (active === item.id || (highlightCrews && item.id === 'crews')) ? colors.border.default : 'transparent',
              '&:hover': { bgcolor: colors.border.default, color: colors.text.primary },
            }}
          >
            {item.id === 'notifications' && unreadNotificationCount > 0 ? (
              <Badge
                badgeContent={unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                color="error"
                sx={{
                  '& .MuiBadge-badge': {
                    fontSize: '0.5rem',
                    height: 14,
                    minWidth: 14,
                    fontFamily: "'JetBrains Mono', monospace",
                  },
                }}
              >
                {item.icon}
              </Badge>
            ) : (
              item.icon
            )}
          </IconButton>
        </Tooltip>
      ))}

      <Box sx={{ flex: 1 }} />
      <Divider sx={{ width: 26, mb: 1, borderColor: colors.border.default }} />

      <Tooltip title={modeLabel} placement="right">
        <IconButton onClick={cycleMode} sx={{ mb: 0.5, color: colors.text.dim, '&:hover': { color: colors.text.primary } }}>
          {modeIcon}
        </IconButton>
      </Tooltip>

      <Tooltip title="Logout" placement="right">
        <IconButton onClick={handleLogout} sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.red } }}>
          <LogoutIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
