import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { colors, alphaColor } from '../theme';
import { migrations, type MigrationStatus, type MigrationRunResult } from '../api';

type Phase = 'checking' | 'up-to-date' | 'pending' | 'running' | 'done' | 'error';

/**
 * Checks for pending schema migrations on mount and, if any are found,
 * runs them automatically with a visible progress UI.
 *
 * Renders children once migrations are up-to-date (or if the check fails
 * — we never block the user from the docking station due to a migration
 * service error).
 */
export function MigrationUpgrade({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [result, setResult] = useState<MigrationRunResult | null>(null);
  const [progressLabel, setProgressLabel] = useState<string>('');
  const ranRef = useRef(false);

  const checkAndRun = useCallback(async () => {
    if (ranRef.current) return;
    ranRef.current = true;

    setPhase('checking');
    try {
      const st = await migrations.status();
      setStatus(st);
      if (st.upToDate) {
        setPhase('up-to-date');
        return;
      }
      // Pending migrations — run them
      setPhase('running');
      setProgressLabel(`Applying ${st.pending.length} pending migration(s)…`);
      try {
        const res = await migrations.run();
        setResult(res);
        if (res.ok) {
          setPhase('done');
          setProgressLabel(
            res.applied > 0
              ? `Applied ${res.applied} migration(s). Schema at v${res.currentVersion}.`
              : `Schema current (v${res.currentVersion}).`,
          );
        } else {
          setPhase('error');
        }
      } catch (runErr) {
        setPhase('error');
      }
    } catch (checkErr) {
      // If we can't even check migration status, don't block the user.
      // The migration will run on next app startup via pgAdapter.connect().
      setPhase('up-to-date');
    }
  }, []);

  useEffect(() => { void checkAndRun(); }, [checkAndRun]);

  // Auto-advance from "done" to showing children after a brief delay
  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(() => setPhase('up-to-date'), 2000);
    return () => clearTimeout(timer);
  }, [phase]);

  // If up-to-date or error (non-blocking), render children immediately
  if (phase === 'up-to-date' || phase === 'error') {
    return <>{children}</>;
  }

  // ─── Upgrade overlay ───
  // Shown when checking for migrations or running them.
  const pendingCount = status?.pending.length ?? 0;
  const appliedCount = result?.applied ?? 0;
  const totalToApply = pendingCount > 0 ? pendingCount : 0;
  const progressValue = phase === 'done'
    ? 100
    : totalToApply > 0
      ? Math.round((appliedCount / totalToApply) * 100)
      : phase === 'checking'
        ? 0
        : 30; // indeterminate-ish while running

  return (
    <Box sx={{
      height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      bgcolor: colors.bg.primary,
      backgroundImage: `radial-gradient(ellipse 80% 50% at 50% -10%, ${alphaColor(colors.accent.blue, '08')}, transparent)`,
      gap: 3,
    }}>
      {/* Logo + title */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <img src="/logo.png" alt="Agent-X" style={{ width: 32, height: 32, objectFit: 'contain' }} />
        <Typography sx={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: "'Inter', sans-serif", color: colors.text.primary }}>
          AGENT-X
        </Typography>
      </Box>

      {/* Upgrade card */}
      <Box sx={{
        width: 420, maxWidth: '90vw',
        bgcolor: colors.bg.secondary,
        border: `1px solid ${colors.border.default}`,
        borderRadius: '8px',
        overflow: 'hidden',
      }}>
        {/* Header bar */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5,
          borderBottom: `1px solid ${colors.border.default}`,
          bgcolor: alphaColor(colors.accent.blue, '08'),
        }}>
          <Box sx={{
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: phase === 'running' ? colors.accent.orange : phase === 'done' ? colors.accent.green : colors.accent.blue,
            ...(phase === 'running' && {
              animation: 'pulse 1.2s ease-in-out infinite',
              '@keyframes pulse': {
                '0%,100%': { opacity: 1, transform: 'scale(1)' },
                '50%': { opacity: 0.5, transform: 'scale(0.8)' },
              },
            }),
          }} />
          <Typography sx={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.6rem', fontWeight: 600, letterSpacing: '2px',
            color: colors.text.secondary,
          }}>
            {phase === 'checking' ? 'CHECKING SCHEMA' :
             phase === 'running' ? 'UPGRADING DATABASE' :
             phase === 'done' ? 'UPGRADE COMPLETE' :
             'SCHEMA'}
          </Typography>
        </Box>

        {/* Body */}
        <Box sx={{ px: 2.5, py: 2.5 }}>
          {/* Status icon + label */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            {phase === 'done' ? (
              <CheckCircleIcon sx={{ fontSize: 20, color: colors.accent.green }} />
            ) : phase === 'running' ? (
              <Box sx={{
                width: 20, height: 20, borderRadius: '50%',
                border: `2px solid ${colors.border.strong}`,
                borderTopColor: colors.accent.blue,
                animation: 'spin 0.8s linear infinite',
                '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
              }} />
            ) : (
              <Box sx={{
                width: 20, height: 20, borderRadius: '50%',
                border: `2px solid ${colors.border.strong}`,
                borderTopColor: colors.accent.blue,
                animation: 'spin 1.2s linear infinite',
                '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
              }} />
            )}
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.72rem', color: colors.text.primary,
            }}>
              {phase === 'checking' ? 'Checking for pending migrations…' :
               phase === 'running' ? progressLabel :
               phase === 'done' ? progressLabel :
               'Preparing…'}
            </Typography>
          </Box>

          {/* Progress bar */}
          {phase !== 'checking' && (
            <LinearProgress
              variant="determinate"
              value={progressValue}
              sx={{
                height: 4, borderRadius: 2,
                bgcolor: colors.bg.tertiary,
                '& .MuiLinearProgress-bar': {
                  bgcolor: phase === 'done' ? colors.accent.green : colors.accent.blue,
                  borderRadius: 2,
                  transition: 'transform 0.5s ease',
                },
              }}
            />
          )}

          {/* Migration list (when running or done) */}
          {status && status.pending.length > 0 && (phase === 'running' || phase === 'done') && (
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {status.pending.map((m) => {
                const isApplied = result?.appliedMigrations?.some((a) => a.version === m.version);
                return (
                  <Box key={m.version} sx={{
                    display: 'flex', alignItems: 'center', gap: 1,
                    fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem',
                  }}>
                    <Box sx={{
                      width: 6, height: 6, borderRadius: '50%',
                      bgcolor: isApplied ? colors.accent.green : colors.text.dim,
                      ...(isApplied && {
                        transition: 'background-color 0.3s ease',
                      }),
                    }} />
                    <Box sx={{ color: isApplied ? colors.accent.green : colors.text.dim }}>
                      V{String(m.version).padStart(3, '0')} — {m.name.replace(/_/g, ' ')}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}

          {/* Version info */}
          {status && (
            <Box sx={{
              mt: 2, pt: 1.5,
              borderTop: `1px solid ${colors.border.subtle}`,
              display: 'flex', justifyContent: 'space-between',
              fontFamily: "'JetBrains Mono', monospace", fontSize: '0.55rem',
            }}>
              <Box sx={{ color: colors.text.dim }}>
                Current: v{status.appliedVersion}
              </Box>
              <Box sx={{ color: colors.text.dim }}>
                Target: v{status.currentVersion}
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Auto-continue hint */}
      {phase === 'done' && (
        <Typography sx={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.55rem', color: colors.text.dim,
          animation: 'fadeIn 0.5s ease',
          '@keyframes fadeIn': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        }}>
          Redirecting to mission control…
        </Typography>
      )}
    </Box>
  );
}
