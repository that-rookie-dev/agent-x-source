import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { palette } from '../theme';

export function Sidebar() {
  return (
    <Box
      sx={{
        width: 260,
        minWidth: 260,
        height: '100%',
        borderRight: `1px solid ${palette.border.subtle}`,
        bgcolor: palette.bg.primary,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${palette.border.subtle}` }}>
        <Typography
          sx={{
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            fontSize: '1rem',
            letterSpacing: '3px',
            color: palette.text.primary,
          }}
        >
          AGENT<span style={{ color: palette.text.dim }}>-</span>X
        </Typography>
      </Box>

      {/* Session list */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 1 }}>
        <Typography variant="overline" sx={{ px: 2, display: 'block', mb: 0.5 }}>
          Recent
        </Typography>
        <List dense disablePadding>
          <ListItemButton
            selected
            sx={{
              mx: 1,
              borderRadius: 1,
              '&.Mui-selected': {
                bgcolor: palette.bg.elevated,
                '&:hover': { bgcolor: palette.bg.hover },
              },
            }}
          >
            <ChatBubbleOutlineIcon sx={{ fontSize: 14, mr: 1.5, color: palette.text.dim }} />
            <ListItemText
              primary="New conversation"
              primaryTypographyProps={{ fontSize: '0.8125rem', noWrap: true }}
            />
          </ListItemButton>
        </List>
      </Box>

      {/* Footer */}
      <Box sx={{ px: 2, py: 1.5, borderTop: `1px solid ${palette.border.subtle}` }}>
        <Typography variant="caption" sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem', color: palette.text.dim }}>
          v0.1.0 • Local
        </Typography>
      </Box>
    </Box>
  );
}
