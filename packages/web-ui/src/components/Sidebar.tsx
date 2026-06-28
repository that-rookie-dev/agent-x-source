import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import ChatIcon from '@mui/icons-material/Chat';
// Hidden until wired — see source/MILESTONE.md
// import ExtensionIcon from '@mui/icons-material/Extension';
// import HubIcon from '@mui/icons-material/Hub';
// import CellTowerIcon from '@mui/icons-material/CellTower';
import SettingsIcon from '@mui/icons-material/Settings';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
// import StorageIcon from '@mui/icons-material/Storage';
import GroupsIcon from '@mui/icons-material/Groups';
// import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LogoutIcon from '@mui/icons-material/Logout';
import DnsIcon from '@mui/icons-material/Dns';
import HubIcon from '@mui/icons-material/Hub';
import MemoryIcon from '@mui/icons-material/Memory';
import { useNavigate } from 'react-router-dom';
import { auth, setAuthToken } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';
import type { PanelId } from '../pages/Console';

interface Props {
  active: PanelId;
  onNavigate: (id: PanelId) => void;
  highlightCrews?: boolean;
}

const NAV_ITEMS: { id: PanelId; icon: typeof ChatIcon; label: string }[] = [
  { id: 'chat', icon: ChatIcon, label: 'Chat' },
  { id: 'brain', icon: MemoryIcon, label: 'Brain' },
  { id: 'health', icon: MonitorHeartIcon, label: 'Health' },
  { id: 'providers', icon: DnsIcon, label: 'Providers' },
  { id: 'crews', icon: GroupsIcon, label: 'Crews' },
  { id: 'settings', icon: SettingsIcon, label: 'Settings' },
  // Hidden until wired — see source/MILESTONE.md
  // { id: 'soul', icon: AutoAwesomeIcon, label: 'Soul' },
  // { id: 'plugins', icon: ExtensionIcon, label: 'Plugins' },
  // { id: 'mcp', icon: HubIcon, label: 'MCP Servers' },
  // { id: 'knowledge', icon: StorageIcon, label: 'Knowledge' },
  // { id: 'channels', icon: CellTowerIcon, label: 'Channels' },
];

export function Sidebar({ active, onNavigate, highlightCrews }: Props) {
  const { setAuthenticated } = useApp();
  const navigate = useNavigate();

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
      {NAV_ITEMS.map((item) => (
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
            <item.icon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      ))}

      <Tooltip title="Brain" placement="right">
        <IconButton
          onClick={() => window.open('/neuron', '_blank', 'noopener,noreferrer')}
          sx={{ mb: 0.5, width: 34, height: 34, borderRadius: 1, color: colors.text.dim, '&:hover': { bgcolor: colors.border.default, color: colors.accent.orange } }}
        >
          <HubIcon sx={{ fontSize: 16, color: colors.accent.orange }} />
        </IconButton>
      </Tooltip>

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
