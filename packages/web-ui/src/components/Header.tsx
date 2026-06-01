import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import MenuIcon from '@mui/icons-material/Menu';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import { palette } from '../theme';

interface HeaderProps {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export function Header({ onToggleSidebar, sidebarOpen }: HeaderProps) {
  return (
    <Box
      sx={{
        height: 48,
        minHeight: 48,
        display: 'flex',
        alignItems: 'center',
        px: 1.5,
        borderBottom: `1px solid ${palette.border.subtle}`,
        bgcolor: palette.bg.primary,
        gap: 1,
      }}
    >
      <Tooltip title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}>
        <IconButton size="small" onClick={onToggleSidebar} sx={{ color: palette.text.tertiary }}>
          <MenuIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Typography
        variant="overline"
        sx={{ flex: 1, ml: 1, fontSize: '0.7rem', letterSpacing: '3px', color: palette.text.dim }}
      >
        AGENT-X CONSOLE
      </Typography>

      <Tooltip title="New chat">
        <IconButton size="small" sx={{ color: palette.text.tertiary }}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Tooltip title="Settings">
        <IconButton size="small" sx={{ color: palette.text.tertiary }}>
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
