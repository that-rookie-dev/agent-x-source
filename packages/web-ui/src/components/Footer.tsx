import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import { colors } from '../theme';
import { health } from '../api';

export interface FooterProps {
  onToggleLogs?: () => void;
  logsOpen?: boolean;
}

export function Footer({ onToggleLogs, logsOpen }: FooterProps) {
  const [version, setVersion] = useState('');

  useEffect(() => {
    health.check().then((h) => setVersion(h.version)).catch(() => {});
  }, []);

  return (
    <Box sx={{
      flexShrink: 0, borderTop: `1px solid ${colors.border.default}`,
      px: 3, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: colors.text.dim,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <span>🇮🇳 Made in India</span>
        <span style={{ color: colors.border.default }}>/</span>
        <span>Powered by Slashpan Technologies Pvt Ltd</span>
        <span style={{ color: colors.border.default }}>/</span>
        <span>
          Created by Sivaprakash Rajendran (
          <a href="mailto:sr@slashpan.com" style={{ color: colors.accent.blue, textDecoration: 'none' }}>sr@slashpan.com</a>
          )
        </span>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {onToggleLogs && (
          <>
            <Box
              component="span"
              onClick={onToggleLogs}
              sx={{
                cursor: 'pointer', letterSpacing: '0.5px', userSelect: 'none',
                color: logsOpen ? colors.accent.blue : colors.text.dim,
                transition: 'color 0.15s',
                '&:hover': { color: colors.text.secondary },
              }}
            >
              logger
            </Box>
            <span style={{ color: colors.border.default }}>/</span>
          </>
        )}
        {version && <span>v{version}</span>}
      </Box>
    </Box>
  );
}
