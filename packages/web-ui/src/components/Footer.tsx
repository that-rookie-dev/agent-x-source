import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import { colors } from '../theme';
import { health, config as configApi } from '../api';

const NEURON_URL = (import.meta.env.VITE_NEURON_URL as string) || '/neuron';

function getZoomShortcutHint(): string {
  if (typeof navigator === 'undefined') return 'zoom Ctrl +/− · Ctrl 0';
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    || navigator.userAgent.includes('Mac');
  return isMac ? 'zoom ⌘ +/− · ⌘ 0' : 'zoom Ctrl +/− · Ctrl 0';
}

export interface FooterProps {
  onToggleLogs?: () => void;
  logsOpen?: boolean;
}

export function Footer({ onToggleLogs, logsOpen }: FooterProps) {
  const [version, setVersion] = useState('');
  const [zoomHint] = useState(getZoomShortcutHint);
  const [neuralBrainDisabled, setNeuralBrainDisabled] = useState(false);

  useEffect(() => {
    health.check().then((h) => setVersion(h.version)).catch(() => {});
    configApi.get().then((cfg) => setNeuralBrainDisabled(cfg.neuralBrain === false)).catch(() => {});
  }, []);

  const handleBrainClick = () => {
    const agentx = (window as unknown as { agentx?: { openInternalWindow?: (url: string) => Promise<boolean> } }).agentx;
    if (agentx?.openInternalWindow) {
      agentx.openInternalWindow(NEURON_URL);
    } else {
      window.open(NEURON_URL, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Box sx={{
      flexShrink: 0, borderTop: `1px solid ${colors.border.default}`,
      px: 3, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem', color: colors.text.dim,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: -0.5 }}>
        {!neuralBrainDisabled && (
          <>
            <Box
              component="span"
              onClick={handleBrainClick}
              sx={{
                display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                color: colors.text.dim, '&:hover': { color: colors.accent.blue },
                transition: 'color 0.15s',
              }}
              title="Open Neural Brain"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
                <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
                <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
                <path d="M3.477 10.896a4 4 0 0 1 .585-.178" />
                <path d="M19.938 10.719a4 4 0 0 1 .586.178" />
                <path d="M6.5 17.599a3 3 0 0 0-1.375.399" />
                <path d="M17.5 17.599a3 3 0 0 0 1.375.399" />
              </svg>
            </Box>
            <span style={{ color: colors.border.default }}>/</span>
          </>
        )}
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
        {version && (
          <>
            <span>v{version}</span>
            <span style={{ color: colors.border.default }}>/</span>
          </>
        )}
        <span>{zoomHint}</span>
      </Box>
    </Box>
  );
}
