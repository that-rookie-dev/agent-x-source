import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

export function DockingStation() {
  const { serverOnline, setView, refreshHealth, healthData } = useApp();
  const [checking, setChecking] = useState(true);
  const [pulsePhase, setPulsePhase] = useState(0);

  const recheckServer = useCallback(async () => {
    setChecking(true);
    await refreshHealth();
    setChecking(false);
  }, [refreshHealth]);

  useEffect(() => { recheckServer(); }, [recheckServer]);

  // Pulse animation
  useEffect(() => {
    const interval = setInterval(() => setPulsePhase((p) => (p + 1) % 360), 50);
    return () => clearInterval(interval);
  }, []);

  const handleLaunch = () => { setView('console'); };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      {/* Background grid */}
      <Box sx={{
        position: 'absolute', inset: 0, opacity: 0.03, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      {/* Scan lines */}
      <Box sx={{
        position: 'absolute', inset: 0, opacity: 0.02, pointerEvents: 'none',
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 4px)',
      }} />

      {/* Central dock */}
      <Box sx={{ textAlign: 'center', zIndex: 1 }}>
        {/* Logo */}
        <Typography variant="h1" sx={{ fontSize: 'clamp(2.5rem, 8vw, 4rem)', mb: 1, color: colors.text.primary }}>
          AGENT<span style={{ color: colors.text.dim }}>-</span>X
        </Typography>
        <Typography variant="overline" sx={{ display: 'block', color: colors.text.dim, mb: 4, letterSpacing: '4px' }}>
          MISSION CONTROL
        </Typography>

        {/* Status orb */}
        <Box sx={{ mb: 4, display: 'flex', justifyContent: 'center' }}>
          <Box sx={{
            width: 120, height: 120, borderRadius: '50%', position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `2px solid ${serverOnline ? colors.accent.green : colors.accent.red}`,
            boxShadow: `0 0 ${20 + Math.sin(pulsePhase * Math.PI / 180) * 10}px ${serverOnline ? colors.accent.green : colors.accent.red}40`,
            transition: 'border-color 0.5s, box-shadow 0.5s',
          }}>
            {checking ? (
              <CircularProgress size={36} sx={{ color: colors.text.tertiary }} />
            ) : serverOnline ? (
              <CheckCircleIcon sx={{ fontSize: 48, color: colors.accent.green }} />
            ) : (
              <ErrorIcon sx={{ fontSize: 48, color: colors.accent.red }} />
            )}
          </Box>
        </Box>

        {/* Status indicators */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mb: 4, flexWrap: 'wrap' }}>
          <StatusChip label="WORKER" status={serverOnline ? 'online' : 'offline'} />
          <StatusChip label="ENGINE" status={serverOnline && healthData?.agentActive ? 'online' : serverOnline ? 'idle' : 'offline'} />
          <StatusChip label="SESSIONS" value={healthData?.sessionCount} status={serverOnline ? 'online' : 'offline'} />
        </Box>

        {/* Memory */}
        {healthData && (
          <Typography variant="caption" sx={{ display: 'block', mb: 3, fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
            MEM: {Math.round((healthData.memory?.heapUsed ?? 0) / 1024 / 1024)}MB •
            UPTIME: {formatUptime(healthData.uptime)}
          </Typography>
        )}

        {/* Launch button */}
        {serverOnline ? (
          <Button
            variant="contained"
            size="large"
            startIcon={<RocketLaunchIcon />}
            onClick={handleLaunch}
            sx={{
              px: 5, py: 1.5,
              bgcolor: colors.text.primary, color: colors.bg.primary,
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: '2px',
              '&:hover': { bgcolor: '#ccc' },
            }}
          >
            LAUNCH CONSOLE
          </Button>
        ) : (
          <Box>
            <Typography variant="body2" sx={{ color: colors.accent.red, mb: 2 }}>
              Worker daemon not detected
            </Typography>
            <Button variant="outlined" onClick={recheckServer} sx={{ borderColor: colors.border.strong, color: colors.text.secondary }}>
              Retry Connection
            </Button>
          </Box>
        )}

        {/* Version */}
        <Typography variant="caption" sx={{ display: 'block', mt: 4, fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
          v0.1.0 • Made in India 🇮🇳
        </Typography>
      </Box>
    </Box>
  );
}

function StatusChip({ label, status, value }: { label: string; status: 'online' | 'offline' | 'idle'; value?: number }) {
  const chipColor = status === 'online' ? colors.accent.green : status === 'idle' ? colors.accent.orange : colors.accent.red;
  return (
    <Chip
      size="small"
      label={`${label}${value !== undefined ? `: ${value}` : ''}`}
      sx={{
        bgcolor: 'transparent', border: `1px solid ${chipColor}40`, color: chipColor,
        fontFamily: "'JetBrains Mono', monospace", fontSize: '0.62rem', letterSpacing: '1px',
      }}
      icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: chipColor, ml: '8px !important' }} />}
    />
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}
