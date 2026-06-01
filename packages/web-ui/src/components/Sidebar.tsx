import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import ChatIcon from '@mui/icons-material/Chat';
import HistoryIcon from '@mui/icons-material/History';
import BuildIcon from '@mui/icons-material/Build';
import ExtensionIcon from '@mui/icons-material/Extension';
import HubIcon from '@mui/icons-material/Hub';
import CellTowerIcon from '@mui/icons-material/CellTower';
import SettingsIcon from '@mui/icons-material/Settings';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ScheduleIcon from '@mui/icons-material/Schedule';
import StorageIcon from '@mui/icons-material/Storage';
import FolderIcon from '@mui/icons-material/Folder';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import LogoutIcon from '@mui/icons-material/Logout';
import { auth } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';
import type { PanelId } from '../pages/Console';

interface Props {
  active: PanelId;
  onNavigate: (id: PanelId) => void;
}

const NAV_ITEMS: { id: PanelId; icon: typeof ChatIcon; label: string }[] = [
  { id: 'chat', icon: ChatIcon, label: 'Chat' },
  { id: 'sessions', icon: HistoryIcon, label: 'Sessions' },
  { id: 'todos', icon: ChecklistIcon, label: 'Todos' },
  { id: 'orchestrator', icon: AccountTreeIcon, label: 'Orchestrator' },
  { id: 'tools', icon: BuildIcon, label: 'Tools' },
  { id: 'plugins', icon: ExtensionIcon, label: 'Plugins' },
  { id: 'mcp', icon: HubIcon, label: 'MCP Servers' },
  { id: 'rag', icon: StorageIcon, label: 'RAG Knowledge' },
  { id: 'files', icon: FolderIcon, label: 'Files' },
  { id: 'bridges', icon: CellTowerIcon, label: 'Bridges' },
  { id: 'scheduler', icon: ScheduleIcon, label: 'Scheduler' },
  { id: 'settings', icon: SettingsIcon, label: 'Settings' },
];

export function Sidebar({ active, onNavigate }: Props) {
  const { setView, setAuthenticated } = useApp();

  const handleLogout = async () => {
    try { await auth.logout(); } catch { /* ignore */ }
    setAuthenticated(false);
    setView('login');
  };

  return (
    <Box sx={{
      width: 56, minWidth: 56, height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', py: 1.5, borderRight: `1px solid ${colors.border.default}`,
      bgcolor: colors.bg.secondary,
    }}>
      {/* Brand mark */}
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: colors.accent.blue, mb: 2, letterSpacing: '1px' }}>
        AX
      </Typography>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => (
        <Tooltip key={item.id} title={item.label} placement="right">
          <IconButton
            onClick={() => onNavigate(item.id)}
            sx={{
              mb: 0.5, width: 40, height: 40, borderRadius: 1,
              color: active === item.id ? colors.text.primary : colors.text.dim,
              bgcolor: active === item.id ? colors.border.default : 'transparent',
              '&:hover': { bgcolor: colors.border.default, color: colors.text.primary },
            }}
          >
            <item.icon sx={{ fontSize: 20 }} />
          </IconButton>
        </Tooltip>
      ))}

      <Box sx={{ flex: 1 }} />
      <Divider sx={{ width: 30, mb: 1, borderColor: colors.border.default }} />

      <Tooltip title="Logout" placement="right">
        <IconButton onClick={handleLogout} sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.red } }}>
          <LogoutIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
