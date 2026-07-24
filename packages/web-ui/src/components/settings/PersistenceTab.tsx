import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import StorageIcon from '@mui/icons-material/Storage';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HelpIcon from '@mui/icons-material/Help';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { settings, factoryReset, setAuthToken, type DbStatus, type DbProvisionStatus } from '../../api';
import { useApp } from '../../store/AppContext';
import { clearAgentxClientStorage } from '../../utils/client-storage';
import { invalidateApiCache, invalidateCoreSessionCache } from '../../perf/api-cache';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsTextFieldSx,
  settingsBtnGhostSx,
  settingsBtnDangerSx,
  settingsDialogPaperSx,
  settingsDialogTitleSx,
  settingsStatusBadgeSx,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';

import { alphaColor } from '../../theme';

type PgBackend = 'embedded-postgres' | 'postgres';

function backendLabel(backend: PgBackend | undefined): string {
  return backend === 'embedded-postgres' ? 'Embedded PostgreSQL' : 'Cloud PostgreSQL';
}

export function PersistenceTab() {
  const { initialize } = useApp();
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState('');
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheResult, setCacheResult] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [provisionStatus, setProvisionStatus] = useState<DbProvisionStatus | { loading: true }>({ loading: true });

  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateConnStr, setMigrateConnStr] = useState('');
  const [migrateTesting, setMigrateTesting] = useState(false);
  const [migrateTestOk, setMigrateTestOk] = useState(false);
  const [migrateTestError, setMigrateTestError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateLogs, setMigrateLogs] = useState<string[]>([]);
  const [migrateComplete, setMigrateComplete] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const migrateLogRef = useRef<HTMLPreElement>(null);

  const ps = 'loading' in provisionStatus ? null : provisionStatus;
  const currentBackend: PgBackend = dbStatus?.postgresBackend ?? ps?.backend ?? 'embedded-postgres';
  const targetBackend: PgBackend = currentBackend === 'embedded-postgres' ? 'postgres' : 'embedded-postgres';
  const migrateButtonLabel = currentBackend === 'embedded-postgres' ? 'Migrate to Cloud PG' : 'Migrate to Embedded PG';

  const loadProvisionStatus = useCallback(async () => {
    setProvisionStatus({ loading: true });
    try {
      const s = await settings.db.provisionStatus();
      setProvisionStatus(s);
    } catch (e) {
      setProvisionStatus({
        postgres: false,
        backend: 'embedded-postgres',
        vectorAvailable: false,
        vectorError: e instanceof Error ? e.message : 'Status check failed',
        schemaVersion: 0,
        migrationsApplied: 0,
        migrationsUpToDate: false,
        pendingMigrations: 0,
        timestamp: new Date().toISOString(),
      });
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await settings.db.get();
      setDbStatus(s);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); loadProvisionStatus(); }, [load, loadProvisionStatus]);

  useEffect(() => {
    if (migrateLogRef.current) {
      migrateLogRef.current.scrollTop = migrateLogRef.current.scrollHeight;
    }
  }, [migrateLogs]);

  const resetMigrateDialog = () => {
    setMigrateConnStr('');
    setMigrateTesting(false);
    setMigrateTestOk(false);
    setMigrateTestError(null);
    setMigrating(false);
    setMigrateLogs([]);
    setMigrateComplete(false);
    setMigrateError(null);
    setRestartRequired(false);
  };

  const openMigrateDialog = () => {
    resetMigrateDialog();
    setMigrateOpen(true);
  };

  const handleTestDestination = async () => {
    if (!migrateConnStr.trim()) {
      setMigrateTestError('Enter a connection string');
      setMigrateTestOk(false);
      return;
    }
    setMigrateTesting(true);
    setMigrateTestError(null);
    setMigrateTestOk(false);
    try {
      const r = await settings.db.test(migrateConnStr.trim());
      if (!r.ok) {
        setMigrateTestError(r.error || 'Connection test failed');
        return;
      }
      setMigrateTestOk(true);
    } catch (e) {
      setMigrateTestError(e instanceof Error ? e.message : 'Connection test failed');
    } finally {
      setMigrateTesting(false);
    }
  };

  const handleStorageTransfer = async () => {
    if (targetBackend === 'postgres' && !migrateTestOk) {
      setMigrateError('Test the cloud connection before migrating.');
      return;
    }

    setMigrating(true);
    setMigrateError(null);
    setMigrateLogs([]);
    setMigrateComplete(false);
    setRestartRequired(false);

    try {
      const result = await settings.db.transfer(
        {
          targetBackend,
          ...(targetBackend === 'postgres' ? { connectionString: migrateConnStr.trim() } : {}),
        },
        (ev) => {
          if (ev.type === 'log' && ev.line) {
            setMigrateLogs((prev) => [...prev, ev.line]);
          } else if (ev.type === 'error') {
            setMigrateError(ev.error);
          } else if (ev.type === 'complete') {
            setMigrateComplete(true);
            setRestartRequired(!!ev.restartRequired);
          }
        },
      );

      if (!result.ok) {
        setMigrateError(result.error || 'Migration failed');
        return;
      }

      setMigrateComplete(true);
      setRestartRequired(!!result.restartRequired);
      await load();
      await loadProvisionStatus();
    } catch (e) {
      setMigrateError(e instanceof Error ? e.message : 'Migration failed');
    } finally {
      setMigrating(false);
    }
  };

  const handleRestartApp = () => {
    window.location.reload();
  };

  const handleClear = async () => {
    setClearing(true);
    try { await settings.db.clear(); setClearOpen(false); setClearConfirm(''); await load(); }
    finally { setClearing(false); }
  };

  const handleClearCache = async () => {
    setClearingCache(true); setCacheResult(null);
    try {
      const r = await settings.db.clearCache();
      setCacheResult(`Freed ${r.freedFormatted}`);
      await load();
      setTimeout(() => setCacheResult(null), 4000);
    } catch (e) { setCacheResult(e instanceof Error ? e.message : 'Failed'); }
    finally { setClearingCache(false); }
  };

  const handleSoftReset = async () => {
    setClearing(true);
    try { await settings.db.clear(); await load(); }
    finally { setClearing(false); }
  };

  const handleFactoryReset = async () => {
    setResetting(true); setResetError('');
    try {
      await factoryReset.reset();
      clearAgentxClientStorage();
      setAuthToken(null);
      invalidateApiCache();
      invalidateCoreSessionCache();
      setResetOpen(false); setResetConfirm('');
      await initialize();
    } catch (e) { setResetError(e instanceof Error ? e.message : 'Factory reset failed'); }
    finally { setResetting(false); }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={20} sx={{ color: settingsTheme.text.dim }} />
      </Box>
    );
  }

  const fs = dbStatus?.fileStorage;
  const statusLoading = 'loading' in provisionStatus && provisionStatus.loading;

  return (
    <Box>
      <SettingsSectionHeader
        icon={<StorageIcon sx={{ fontSize: 16 }} />}
        title="Storage"
        subtitle={dbStatus?.connected ? `${backendLabel(currentBackend)} · ${dbStatus.stats.dbSizeFormatted || '—'}` : 'Disconnected'}
        action={
          <Button
            size="small"
            variant="outlined"
            startIcon={<SwapHorizIcon sx={{ fontSize: 14 }} />}
            onClick={openMigrateDialog}
            disabled={!dbStatus?.connected || migrating}
            sx={settingsBtnGhostSx}
          >
            {migrateButtonLabel}
          </Button>
        }
      />

      <SettingsCard title="Active Backend">
        <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Box sx={settingsStatusBadgeSx('active')}>{backendLabel(currentBackend)}</Box>
          <Box sx={settingsStatusBadgeSx(dbStatus?.connected ? 'active' : 'warn')}>
            {dbStatus?.connected ? 'Connected' : 'Disconnected'}
          </Box>
        </Box>
        <Typography sx={settingsHelperSx}>
          Sessions, messages, memories, and domain data live in PostgreSQL. Credentials stay in local encrypted config.
        </Typography>
      </SettingsCard>

      <SettingsCard title="Database health" subtitle="Extensions and schema">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
          <HealthCard
            label="PostgreSQL"
            status={dbStatus?.connected ? 'ok' : 'fail'}
          />
          <HealthCard
            label="pgvector"
            status={statusLoading ? 'pending' : (ps?.vectorAvailable ? 'ok' : 'fail')}
          />
          <HealthCard
            label="Migrations"
            status={statusLoading ? 'pending' : (ps?.migrationsUpToDate ? 'ok' : (ps?.schemaVersion && ps.schemaVersion > 0 ? 'warn' : 'fail'))}
            detail={ps && !ps.migrationsUpToDate && ps.pendingMigrations > 0 ? `${ps.pendingMigrations} pending` : undefined}
          />
        </Box>
      </SettingsCard>

      <SettingsCard title="Database Stats">
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0.75 }}>
          <StatItem label="Size" value={dbStatus?.stats.dbSizeFormatted || '—'} />
          <StatItem label="Tables" value={String(dbStatus?.stats.tableCount || 0)} />
          {dbStatus?.health && (
            <StatItem label="Health" value={dbStatus.health.status === 'healthy' ? 'Good' : 'Issues'}
              color={dbStatus.health.status === 'healthy' ? settingsTheme.accent.signal : settingsTheme.accent.amber} />
          )}
          <StatItem label="Sessions" value={String(dbStatus?.stats.tables?.['sessions'] ?? 0)} />
          <StatItem label="Messages" value={String(dbStatus?.stats.tables?.['messages'] ?? 0)} />
          <StatItem label="Memories" value={String(dbStatus?.stats.tables?.['crew_memories'] ?? 0)} />
        </Box>
      </SettingsCard>

      <SettingsCard title="File Storage">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, mb: 1.5 }}>
          <FilePathRow label="Config" path={fs?.config.path ?? '~/.config/agentx'} size={fs?.config.sizeFormatted ?? '—'}
            desc="Provider configs, plugin registry, ACP settings, crew registry" />
          <FilePathRow label="Data" path={fs?.data.path ?? '~/.local/share/agentx'} size={fs?.data.sizeFormatted ?? '—'}
            desc="Session files, persona.json, crews.json, markdown documents" />
          <FilePathRow label="Cache" path={fs?.cache.path ?? '~/.cache/agentx'} size={fs?.cache.sizeFormatted ?? '—'}
            desc="Temporary files, content cache, compaction buffers" />
        </Box>

        <Box sx={{ p: 1.5, borderRadius: '4px', bgcolor: settingsTheme.bg.hud, border: `1px solid ${settingsTheme.border.subtle}`, mb: 1.5 }}>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.55rem', color: settingsTheme.text.dim, lineHeight: 1.7 }}>
            <Box component="span" sx={{ color: settingsTheme.accent.amber, fontWeight: 700 }}>Warning:</Box>{' '}
            Manually editing files in these directories can cause data loss or agent instability.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="small" variant="outlined" startIcon={<CleaningServicesIcon sx={{ fontSize: 14 }} />} onClick={handleClearCache} disabled={clearingCache} sx={settingsBtnGhostSx}>
            {clearingCache ? <CircularProgress size={14} /> : 'Clear Logs & Cache'}
          </Button>
          {cacheResult && (
            <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.accent.signal, ...settingsMonoSx }}>{cacheResult}</Typography>
          )}
        </Box>
      </SettingsCard>

      <SettingsCard title="Soft Reset" accent={settingsTheme.accent.amber}>
        <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
          Clears domain data — sessions, messages, memories, crews, plugins. Credentials and provider config remain intact.
        </Typography>
        <Button size="small" variant="outlined" startIcon={<RestartAltIcon sx={{ fontSize: 14 }} />} onClick={handleSoftReset} disabled={clearing}
          sx={{ ...settingsBtnGhostSx, border: `1px solid ${alphaColor(settingsTheme.accent.amber, '55')}`, borderColor: `${alphaColor(settingsTheme.accent.amber, '55')}`, color: settingsTheme.accent.amber }}>
          {clearing ? 'Clearing…' : 'Soft Reset'}
        </Button>
      </SettingsCard>

      <SettingsCard title="Clear Domain Data" accent={settingsTheme.accent.alert}>
        <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
          Same as soft reset with explicit confirmation. Erases domain data while keeping credentials.
        </Typography>
        <Button variant="outlined" startIcon={<DeleteOutlineIcon />} onClick={() => setClearOpen(true)} disabled={clearing} sx={settingsBtnDangerSx}>
          {clearing ? 'Clearing…' : 'Clear Domain Data'}
        </Button>
      </SettingsCard>

      <SettingsCard title="Factory Reset" accent={settingsTheme.accent.alert}>
        <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
          Irreversibly deletes all local files, domain data, and credentials. Logs you out completely.
        </Typography>
        <Button variant="outlined" onClick={() => setResetOpen(true)} disabled={resetting} sx={settingsBtnDangerSx}>
          {resetting ? <CircularProgress size={14} /> : 'Factory Reset'}
        </Button>
      </SettingsCard>

      <Dialog
        open={migrateOpen}
        onClose={() => !migrating && setMigrateOpen(false)}
        PaperProps={{ sx: { ...settingsDialogPaperSx, maxWidth: 520 } }}
      >
        <DialogTitle sx={settingsDialogTitleSx}>{migrateButtonLabel}</DialogTitle>
        <DialogContent>
          <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
            {targetBackend === 'postgres'
              ? 'Enter your cloud PostgreSQL credentials. Agent-X will test the connection, then copy all data from embedded storage with upsert.'
              : 'Agent-X will start bundled embedded PostgreSQL and copy all data from your cloud database into local storage.'}
          </Typography>

          {targetBackend === 'postgres' && !migrateComplete && (
            <>
              <TextField
                size="small"
                fullWidth
                label="Connection string"
                placeholder="postgresql://user:pass@host:5432/agentx?sslmode=no-verify"
                value={migrateConnStr}
                onChange={(e) => { setMigrateConnStr(e.target.value); setMigrateTestOk(false); setMigrateTestError(null); }}
                disabled={migrating}
                sx={{ ...settingsTextFieldSx, mb: 1.5 }}
              />
              <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
                <Button
                  variant="outlined"
                  onClick={handleTestDestination}
                  disabled={migrating || migrateTesting || !migrateConnStr.trim()}
                  sx={settingsBtnGhostSx}
                >
                  {migrateTesting ? <CircularProgress size={14} /> : 'Test Connection'}
                </Button>
                {migrateTestOk && (
                  <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.accent.signal, ...settingsMonoSx }}>
                    Connection OK
                  </Typography>
                )}
              </Box>
              {migrateTestError && (
                <Alert severity="error" sx={{ fontSize: '0.65rem', mb: 1.5, ...settingsMonoSx }}>{migrateTestError}</Alert>
              )}
            </>
          )}

          {(migrating || migrateLogs.length > 0) && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.55rem', color: settingsTheme.text.dim, mb: 0.5 }}>
                MIGRATION LOG
              </Typography>
              <Box
                component="pre"
                ref={migrateLogRef}
                sx={{
                  ...settingsMonoSx,
                  fontSize: '0.55rem',
                  maxHeight: 180,
                  overflow: 'auto',
                  p: 1,
                  m: 0,
                  bgcolor: settingsTheme.bg.hud,
                  border: `1px solid ${settingsTheme.border.subtle}`,
                  borderRadius: '4px',
                  whiteSpace: 'pre-wrap',
                  color: settingsTheme.text.secondary,
                }}
              >
                {migrateLogs.length === 0 ? 'Starting…' : migrateLogs.join('\n')}
              </Box>
            </Box>
          )}

          {migrateComplete && (
            <Alert severity="success" sx={{ fontSize: '0.65rem', mb: 1, ...settingsMonoSx }}>
              Migration complete. Storage configuration has been updated to {backendLabel(targetBackend)}.
            </Alert>
          )}
          {migrateError && (
            <Alert severity="error" sx={{ fontSize: '0.65rem', mb: 1, ...settingsMonoSx }}>{migrateError}</Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2, flexWrap: 'wrap', gap: 1 }}>
          {!migrateComplete && (
            <Button size="small" variant="outlined" onClick={() => setMigrateOpen(false)} disabled={migrating} sx={settingsBtnGhostSx}>
              Cancel
            </Button>
          )}
          {!migrateComplete && !migrating && (
            <Button
              size="small"
              variant="outlined"
              onClick={handleStorageTransfer}
              disabled={targetBackend === 'postgres' && !migrateTestOk}
              sx={settingsBtnGhostSx}
            >
              Start Migration
            </Button>
          )}
          {migrating && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} />
              <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>Migrating…</Typography>
            </Box>
          )}
          {migrateComplete && restartRequired && (
            <Button
              variant="outlined"
              startIcon={<RestartAltIcon sx={{ fontSize: 14 }} />}
              onClick={handleRestartApp}
              sx={settingsBtnGhostSx}
            >
              Restart App
            </Button>
          )}
          {migrateComplete && (
            <Button size="small" variant="outlined" onClick={() => { setMigrateOpen(false); resetMigrateDialog(); }} sx={settingsBtnGhostSx}>
              Close
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={clearOpen} onClose={() => setClearOpen(false)} PaperProps={{ sx: { ...settingsDialogPaperSx, maxWidth: 420 } }}>
        <DialogTitle sx={settingsDialogTitleSx}>Clear Domain Data</DialogTitle>
        <DialogContent>
          <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
            Type <strong>DELETE</strong> to confirm. Credentials and auth are preserved.
          </Typography>
          <TextField size="small" fullWidth value={clearConfirm} onChange={(e) => setClearConfirm(e.target.value)}
            placeholder="DELETE" sx={settingsTextFieldSx} />
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button size="small" variant="outlined" onClick={() => setClearOpen(false)} sx={settingsBtnGhostSx}>Cancel</Button>
          <Button size="small" variant="outlined" onClick={handleClear} disabled={clearConfirm !== 'DELETE' || clearing} sx={settingsBtnDangerSx}>
            {clearing ? 'Clearing…' : 'Clear'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} PaperProps={{ sx: { ...settingsDialogPaperSx, maxWidth: 420 } }}>
        <DialogTitle sx={settingsDialogTitleSx}>Factory Reset</DialogTitle>
        <DialogContent>
          <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
            Deletes all local files, domain data, and credentials. Type <strong>RESET</strong> to confirm.
          </Typography>
          {resetError && <Alert severity="error" sx={{ fontSize: '0.65rem', mb: 1, ...settingsMonoSx }}>{resetError}</Alert>}
          <TextField size="small" fullWidth value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)}
            placeholder="RESET" sx={settingsTextFieldSx} />
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button size="small" variant="outlined" onClick={() => setResetOpen(false)} sx={settingsBtnGhostSx}>Cancel</Button>
          <Button size="small" variant="outlined" onClick={handleFactoryReset} disabled={resetConfirm !== 'RESET' || resetting} sx={settingsBtnDangerSx}>
            {resetting ? 'Resetting…' : 'Reset Everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function HealthCard({ label, status, detail }: { label: string; status: 'ok' | 'warn' | 'fail' | 'pending'; detail?: string }) {
  const icon = status === 'ok' ? <CheckCircleIcon sx={{ fontSize: 13, color: settingsTheme.accent.signal }} />
    : status === 'warn' ? <WarningAmberIcon sx={{ fontSize: 13, color: settingsTheme.accent.amber }} />
    : status === 'fail' ? <ErrorIcon sx={{ fontSize: 13, color: settingsTheme.accent.alert }} />
    : <HelpIcon sx={{ fontSize: 13, color: settingsTheme.text.dim }} />;
  const text = status === 'ok' ? 'OK' : status === 'warn' ? (detail ?? 'Warn') : status === 'fail' ? 'Failed' : '…';
  const color = status === 'ok' ? settingsTheme.accent.signal : status === 'warn' ? settingsTheme.accent.amber : status === 'fail' ? settingsTheme.accent.alert : settingsTheme.text.dim;
  return (
    <Box sx={{ p: 1, borderRadius: '4px', bgcolor: settingsTheme.bg.hud, border: `1px solid ${settingsTheme.border.subtle}`, minHeight: 56 }}>
      <Typography sx={{ fontSize: '0.5rem', color: settingsTheme.text.dim, mb: 0.5, ...settingsMonoSx, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {icon}
        <Typography sx={{ fontSize: '0.62rem', color, fontWeight: 700, ...settingsMonoSx }}>{text}</Typography>
      </Box>
    </Box>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ p: 1, borderRadius: '4px', bgcolor: settingsTheme.bg.hud, border: `1px solid ${settingsTheme.border.subtle}` }}>
      <Typography sx={{ fontSize: '0.5rem', color: settingsTheme.text.dim, mb: 0.35, ...settingsMonoSx, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.68rem', color: color || settingsTheme.text.primary, fontWeight: 700, ...settingsMonoSx }}>{value}</Typography>
    </Box>
  );
}

function FilePathRow({ label, path, size, desc }: { label: string; path: string; size: string; desc: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
      <Box>
        <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.primary, fontWeight: 700, ...settingsMonoSx }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>{path}</Typography>
        <Typography sx={{ fontSize: '0.52rem', color: settingsTheme.text.dim, mt: 0.25 }}>{desc}</Typography>
      </Box>
      <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.secondary, ...settingsMonoSx, whiteSpace: 'nowrap' }}>{size}</Typography>
    </Box>
  );
}
