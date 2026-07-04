import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import ChatIcon from '@mui/icons-material/Chat';
// Hidden until wired — see source/MILESTONE.md
// import ExtensionIcon from '@mui/icons-material/Extension';
import ExtensionIcon from '@mui/icons-material/Extension';
import ScheduleIcon from '@mui/icons-material/Schedule';
// import CellTowerIcon from '@mui/icons-material/CellTower';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import GroupsIcon from '@mui/icons-material/Groups';
// import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LogoutIcon from '@mui/icons-material/Logout';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import Badge from '@mui/material/Badge';
import { useNavigate } from 'react-router-dom';
import { auth, setAuthToken } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';
import type { PanelId } from '../pages/Console';
import { useNeuralBrainSupported } from '../hooks/useSystemCapabilities';

interface Props {
  active: PanelId;
  onNavigate: (id: PanelId) => void;
  highlightCrews?: boolean;
  unreadNotificationCount?: number;
}

const NAV_ITEMS: { id: PanelId; icon: typeof ChatIcon; label: string }[] = [
  { id: 'chat', icon: ChatIcon, label: 'Chat' },
  { id: 'notifications', icon: NotificationsNoneIcon, label: 'Notifications' },
  { id: 'automation', icon: ScheduleIcon, label: 'Automation' },
  { id: 'crews', icon: GroupsIcon, label: 'Crews' },
  { id: 'rag-studio', icon: StorageIcon, label: 'RAG Studio' },
  { id: 'mcp-store', icon: ExtensionIcon, label: 'MCP Store' },
  { id: 'settings', icon: SettingsIcon, label: 'Settings' },
  // Hidden until wired — see source/MILESTONE.md
  // { id: 'soul', icon: AutoAwesomeIcon, label: 'Soul' },
  // { id: 'plugins', icon: ExtensionIcon, label: 'Plugins' },
  // { id: 'plugins', icon: ExtensionIcon, label: 'Plugins' },
  // { id: 'channels', icon: CellTowerIcon, label: 'Channels' },
];

export function Sidebar({ active, onNavigate, highlightCrews, unreadNotificationCount = 0 }: Props) {
  const { setAuthenticated } = useApp();
  const navigate = useNavigate();
  const neuralBrainSupported = useNeuralBrainSupported();

  const navItems = NAV_ITEMS.filter((item) =>
    item.id !== 'rag-studio' || neuralBrainSupported,
  );

  const handleLogout = async () => {
    try { await auth.logout(); } catch { /* ignore */ }
    setAuthToken(null);
    setAuthenticated(false);
    navigate('/login');
  };

  return (
    <Box sx={{
      width: 48, minWidth: 48, height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', py: 1.5, borderRight: `1px solid ${colors.border.default}`,
      bgcolor: colors.bg.secondary,
    }}>
      {/* Brand mark */}
      <Tooltip title="@agentx" placement="right">
        <Box sx={{ mb: 2, cursor: 'default' }}>
          <img src="/logo.png" alt="Agent-X" style={{ width: 24, height: 24, objectFit: 'contain' }} />
        </Box>
      </Tooltip>

      {/* Nav items */}
      {navItems.map((item) => (
        <Tooltip key={item.id} title={item.label} placement="right">
          <IconButton
            onClick={() => onNavigate(item.id)}
            sx={{
              mb: 0.5, width: 34, height: 34, borderRadius: 1,
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
                <item.icon sx={{ fontSize: 16 }} />
              </Badge>
            ) : (
              <item.icon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Tooltip>
      ))}

      <Box sx={{ flex: 1 }} />
      <Divider sx={{ width: 26, mb: 1, borderColor: colors.border.default }} />

      <Tooltip title="Logout" placement="right">
        <IconButton onClick={handleLogout} sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.red } }}>
          <LogoutIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
