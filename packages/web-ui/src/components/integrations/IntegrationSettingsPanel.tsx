import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { settingsTheme } from '../../styles/settings-theme';

const DEFAULT_HEALTH_POLL_MINUTES = 5;

export function IntegrationSettingsPanel() {
  return (
    <Box sx={{ maxWidth: 520 }}>
      <Typography sx={{ fontSize: '0.8rem', color: settingsTheme.text.secondary, lineHeight: 1.6 }}>
        Connected MCP servers are checked in the background every {DEFAULT_HEALTH_POLL_MINUTES} minutes.
        If a server stops responding, it is marked unhealthy until it recovers on the next check.
      </Typography>
    </Box>
  );
}
