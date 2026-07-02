import { useState, useEffect, useCallback } from 'react';
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
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HelpIcon from '@mui/icons-material/Help';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { settings, factoryReset, setAuthToken, knowledge, type DbStatus } from '../../api';
import { useApp } from '../../store/AppContext';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsTextFieldSx,
  settingsBtnGhostSx,
  settingsBtnDangerSx,
  settingsDialogPaperSx,
  settingsDialogTitleSx,
  settingsToggleGroupSx,
  settingsStatusBadgeSx,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';

export function PersistenceTab() {
  const { initialize } = useApp();
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState('');
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheResult, setCacheResult] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [provisionMode, setProvisionMode] = useState<'embedded' | 'cloud'>('embedded');
  const [provisionStatus, setProvisionStatus] = useState<{
    loading: boolean;
    postgres?: boolean;
    schemaVersion?: number;
    migrationsApplied?: number;
    ageAvailable?: boolean;
    ageError?: string | null;
    timestamp?: string;
  }>({ loading: false });

  const loadProvisionStatus = useCallback(async () => {
    setProvisionStatus({ loading: true });
    try {
      const s = await settings.db.provisionStatus();
      setProvisionStatus({
        loading: false,
        postgres: s.postgres,
        schemaVersion: s.schemaVersion,
        migrationsApplied: s.migrationsApplied,
        ageAvailable: s.age.available,
        ageError: s.age.error,
        timestamp: s.timestamp,
      });
    } catch (e) {
      setProvisionStatus({ loading: false, postgres: false, ageAvailable: false, ageError: e instanceof Error ? e.message : 'Status check failed' });
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

  const handleMigrate = async () => {
    setMigrating(true); setMigrateResult(null);
    try {
      const r = await settings.db.migrate();
      setMigrateResult(r.ok && r.migrated
        ? `Migrated ${Object.entries(r.migrated).filter(([,v]) => v > 0).length} tables in ${r.durationMs}ms.`
        : 'Migration failed: ' + (r.error || 'unknown'));
      await load();
    } catch (e) { setMigrateResult(e instanceof Error ? e.message : 'Migration failed'); }
    finally { setMigrating(false); }
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
      setAuthToken(null);
      sessionStorage.removeItem('agentx_auth_token');
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

  return (
    <Box>
      <SettingsSectionHeader
        icon={<StorageIcon sx={{ fontSize: 16 }} />}
        title="Storage"
        subtitle={dbStatus?.connected ? `PostgreSQL · ${dbStatus.stats.dbSizeFormatted || '—'}` : 'Disconnected'}
      />

      <SettingsCard title="Active Backend">
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          <Box sx={settingsStatusBadgeSx('active')}>PostgreSQL</Box>
          <Box sx={settingsStatusBadgeSx(dbStatus?.connected ? 'active' : 'warn')}>
            {dbStatus?.connected ? 'Connected' : 'Disconnected'}
          </Box>
        </Box>
        <Typography sx={settingsHelperSx}>
          Sessions, messages, memories, and domain data live in PostgreSQL. Credentials stay in local encrypted config.
        </Typography>
      </SettingsCard>

      <SettingsCard
        title="Provisioning"
        subtitle="Database extensions and schema health"
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1, mt: -0.5 }}>
          <Button onClick={loadProvisionStatus} disabled={provisionStatus.loading} size="small" sx={settingsBtnGhostSx}>
            {provisionStatus.loading ? <CircularProgress size={12} /> : <RefreshIcon sx={{ fontSize: 14 }} />}
          </Button>
        </Box>

        <ToggleButtonGroup value={provisionMode} exclusive size="small" fullWidth
          onChange={(_, v) => v && setProvisionMode(v)} sx={{ mb: 1.5, ...settingsToggleGroupSx }}>
          <ToggleButton value="embedded">Embedded Local</ToggleButton>
          <ToggleButton value="cloud">External / Cloud</ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <TelemetryRow label="PostgreSQL connection" status={dbStatus?.connected ? 'ok' : 'fail'} />
          <TelemetryRow label="pgvector extension" status={provisionStatus.loading ? 'pending' : (provisionStatus.postgres ? 'ok' : 'fail')} />
          <TelemetryRow label="Schema migrations" status={provisionStatus.loading ? 'pending' : ((provisionStatus.migrationsApplied ?? 0) > 0 ? 'ok' : (provisionStatus.schemaVersion && provisionStatus.schemaVersion > 0 ? 'ok' : 'fail'))} />
          <TelemetryRow label="Apache AGE graph" status={provisionStatus.loading ? 'pending' : (provisionStatus.ageAvailable ? 'ok' : 'warn')} />
        </Box>

        {provisionMode === 'cloud' && !provisionStatus.ageAvailable && !provisionStatus.loading && (
          <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mt: 1.5, fontSize: '0.65rem', bgcolor: `${settingsTheme.accent.amber}12`, border: `1px solid ${settingsTheme.accent.amber}33`, ...settingsMonoSx }}>
            Cloud PostgreSQL lacks Apache AGE. Graph walks use recursive-CTE fallback.
          </Alert>
        )}
      </SettingsCard>

      <SettingsCard title="Database Stats">
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1, mt: -0.5 }}>
          <Button size="small" startIcon={<RefreshIcon sx={{ fontSize: 14 }} />} onClick={load} sx={settingsBtnGhostSx}>
            Refresh
          </Button>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
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
        <Box sx={{ mt: 1.5 }}>
          <Button variant="outlined" onClick={handleMigrate} disabled={migrating} sx={settingsBtnGhostSx}>
            {migrating ? <CircularProgress size={14} /> : 'Run Schema Migration'}
          </Button>
          {migrateResult && (
            <Typography sx={{ fontSize: '0.6rem', color: migrateResult.includes('failed') ? settingsTheme.accent.alert : settingsTheme.accent.signal, mt: 1, ...settingsMonoSx }}>
              {migrateResult}
            </Typography>
          )}
        </Box>
      </SettingsCard>

      <SettingsCard title="File Storage">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, mb: 1.5 }}>
          <FilePathRow label="Config" path={fs?.config.path ?? '~/.config/agentx'} size={fs?.config.sizeFormatted ?? '—'}
            desc="Provider configs, plugin registry, MCP/ACP settings, crew registry" />
          <FilePathRow label="Data" path={fs?.data.path ?? '~/.local/share/agentx'} size={fs?.data.sizeFormatted ?? '—'}
            desc="Session files, secret sauce (soul, memories, diary, identity)" />
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
          <Button variant="outlined" startIcon={<CleaningServicesIcon />} onClick={handleClearCache} disabled={clearingCache} sx={settingsBtnGhostSx}>
            {clearingCache ? <CircularProgress size={14} /> : 'Clear Logs & Cache'}
          </Button>
          {cacheResult && (
            <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.accent.signal, ...settingsMonoSx }}>{cacheResult}</Typography>
          )}
        </Box>
      </SettingsCard>

      <RagStudioStorageCard />

      <SettingsCard title="Soft Reset" accent={settingsTheme.accent.amber}>
        <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
          Clears domain data — sessions, messages, memories, crews, plugins. Credentials and provider config remain intact.
        </Typography>
        <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={handleSoftReset} disabled={clearing}
          sx={{ ...settingsBtnGhostSx, borderColor: `${settingsTheme.accent.amber}55`, color: settingsTheme.accent.amber }}>
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
          <Button onClick={() => setClearOpen(false)} sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim }}>Cancel</Button>
          <Button onClick={handleClear} disabled={clearConfirm !== 'DELETE' || clearing} sx={settingsBtnDangerSx}>
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
          <Button onClick={() => setResetOpen(false)} sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.dim }}>Cancel</Button>
          <Button onClick={handleFactoryReset} disabled={resetConfirm !== 'RESET' || resetting} sx={settingsBtnDangerSx}>
            {resetting ? 'Resetting…' : 'Reset Everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function TelemetryRow({ label, status }: { label: string; status: 'ok' | 'warn' | 'fail' | 'pending' }) {
  const icon = status === 'ok' ? <CheckCircleIcon sx={{ fontSize: 14, color: settingsTheme.accent.signal }} />
    : status === 'warn' ? <WarningAmberIcon sx={{ fontSize: 14, color: settingsTheme.accent.amber }} />
    : status === 'fail' ? <ErrorIcon sx={{ fontSize: 14, color: settingsTheme.accent.alert }} />
    : <HelpIcon sx={{ fontSize: 14, color: settingsTheme.text.dim }} />;
  const text = status === 'ok' ? 'OK' : status === 'warn' ? 'Warning' : status === 'fail' ? 'Failed' : 'Checking';
  const color = status === 'ok' ? settingsTheme.accent.signal : status === 'warn' ? settingsTheme.accent.amber : status === 'fail' ? settingsTheme.accent.alert : settingsTheme.text.dim;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5, borderBottom: `1px solid ${settingsTheme.border.subtle}` }}>
      <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.secondary, ...settingsMonoSx }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {icon}
        <Typography sx={{ fontSize: '0.58rem', color, fontWeight: 600, ...settingsMonoSx }}>{text}</Typography>
      </Box>
    </Box>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ p: 1.25, borderRadius: '4px', bgcolor: settingsTheme.bg.hud, border: `1px solid ${settingsTheme.border.subtle}` }}>
      <Typography sx={{ fontSize: '0.52rem', color: settingsTheme.text.dim, mb: 0.4, ...settingsMonoSx, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.72rem', color: color || settingsTheme.text.primary, fontWeight: 700, ...settingsMonoSx }}>{value}</Typography>
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

function formatBytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function RagStudioStorageCard() {
  const [stats, setStats] = useState<{ fileCount: number; totalBytes: number; path: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStats(await knowledge.storageStats()); } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    setClearing(true);
    try {
      const r = await knowledge.clearStorage();
      setResult(`Deleted ${r.deletedFiles} files, freed ${formatBytes(r.freedBytes)}`);
      setConfirmOpen(false);
      await load();
      setTimeout(() => setResult(null), 4000);
    } catch (e) { setResult(e instanceof Error ? e.message : 'Failed'); }
    finally { setClearing(false); }
  };

  return (
    <SettingsCard title="RAG Studio Storage" subtitle="Original copies of uploaded documents. Clearing does not delete knowledge entries in the brain.">
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={18} sx={{ color: settingsTheme.text.dim }} />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          <StatItem label="Files" value={stats ? String(stats.fileCount) : '—'} />
          <StatItem label="Total Size" value={stats ? formatBytes(stats.totalBytes) : '—'} />
        </Box>
      )}

      {stats && stats.fileCount > 0 && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<DeleteOutlineIcon />}
            onClick={() => setConfirmOpen(true)} disabled={clearing} sx={settingsBtnDangerSx}>
            {clearing ? <CircularProgress size={14} /> : 'Clear RAG Studio Files'}
          </Button>
          {result && (
            <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.accent.signal, ...settingsMonoSx }}>{result}</Typography>
          )}
        </Box>
      )}

      {confirmOpen && (
        <Box sx={{ mt: 1.5, p: 1.5, borderRadius: '4px', bgcolor: `${settingsTheme.accent.alert}08`, border: `1px solid ${settingsTheme.accent.alert}33` }}>
          <Typography sx={{ ...settingsHelperSx, mb: 1.25 }}>
            Delete all original file copies? Knowledge entries remain in the brain.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" onClick={() => setConfirmOpen(false)} sx={{ ...settingsMonoSx, fontSize: '0.6rem', color: settingsTheme.text.dim }}>Cancel</Button>
            <Button size="small" variant="contained" onClick={handleClear} disabled={clearing} sx={{ ...settingsBtnDangerSx, bgcolor: settingsTheme.accent.alert, color: '#fff', border: 'none' }}>
              {clearing ? 'Clearing…' : 'Delete Files'}
            </Button>
          </Box>
        </Box>
      )}
    </SettingsCard>
  );
}
