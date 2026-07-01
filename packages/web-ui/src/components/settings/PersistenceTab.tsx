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
import FolderIcon from '@mui/icons-material/Folder';
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
import { crewTheme } from '../../styles/crew-theme';
import { colors } from '../../theme';

const cardSx = {
  position: 'relative' as const,
  bgcolor: crewTheme.bg.inset,
  border: `1px solid ${crewTheme.border.default}`,
  borderRadius: '8px',
  p: 3,
};

const dangerCardSx = {
  ...cardSx,
  border: `1px solid ${crewTheme.accent.alert}33`,
  bgcolor: `${crewTheme.accent.alert}08`,
};

export function PersistenceTab() {
  const { initialize } = useApp();
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pgConnStr, setPgConnStr] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; version?: string; tablesCreated?: number; error?: string } | null>(null);
  const [switching, setSwitching] = useState(false);
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
      setPgConnStr(s.postgres?.connectionString || '');
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); loadProvisionStatus(); }, [load, loadProvisionStatus]);

  const handleTest = async () => {
    if (!pgConnStr) return;
    setTesting(true);
    setTestResult(null);
    try { setTestResult(await settings.db.test(pgConnStr)); }
    catch (e) { setTestResult({ ok: false, error: e instanceof Error ? e.message : 'Test failed' }); }
    finally { setTesting(false); }
  };

  const handleSwitch = async () => {
    if (!pgConnStr) return;
    setSwitching(true);
    try { await settings.db.update({ backend: 'postgres', postgres: { connectionString: pgConnStr } }); await load(); }
    catch (e) { setTestResult({ ok: false, error: e instanceof Error ? e.message : 'Switch failed' }); }
    finally { setSwitching(false); }
  };

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
        <CircularProgress size={24} sx={{ color: colors.text.secondary }} />
      </Box>
    );
  }

  const fs = dbStatus?.fileStorage;

  return (
    <Box>
      {/* ── Active Backend ── */}
      <Box sx={{ ...cardSx, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
          <StorageIcon sx={{ fontSize: 18, color: colors.text.secondary }} />
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: colors.text.primary }}>
            Active Backend
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          <Button variant="contained" disabled
            sx={{ flex: 1, py: 1.5, fontSize: '0.78rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textTransform: 'none',
              bgcolor: colors.text.primary, color: colors.bg.primary, borderColor: colors.border.default }}>
            PostgreSQL ✓
          </Button>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dbStatus?.connected ? colors.accent.green : colors.accent.red }} />
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary }}>
            {dbStatus?.connected ? 'Connected' : 'Disconnected'}
            {' · '}
            PostgreSQL · {dbStatus?.stats.dbSizeFormatted || '—'}
          </Typography>
        </Box>
      </Box>

      {/* ── Provisioning Telemetry ── */}
      <Box sx={{ ...cardSx, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.text.primary }}>
            Provisioning Telemetry
          </Typography>
          <Button onClick={loadProvisionStatus} disabled={provisionStatus.loading} size="small"
            sx={{ fontSize: '0.65rem', color: colors.text.secondary, textTransform: 'none', borderColor: colors.border.default }}>
            {provisionStatus.loading ? <CircularProgress size={12} sx={{ color: colors.text.secondary }} /> : <RefreshIcon sx={{ fontSize: 14 }} />}
          </Button>
        </Box>

        <ToggleButtonGroup value={provisionMode} exclusive size="small" fullWidth
          onChange={(_, v) => v && setProvisionMode(v)} sx={{ mb: 2, '& .MuiToggleButton-root': { fontSize: '0.7rem', textTransform: 'none', color: colors.text.secondary } }}>
          <ToggleButton value="embedded">Embedded Local</ToggleButton>
          <ToggleButton value="cloud">External / Cloud</ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TelemetryRow label="PostgreSQL connection" status={dbStatus?.connected ? 'ok' : 'fail'} />
          <TelemetryRow label="pgvector extension" status={provisionStatus.loading ? 'pending' : (provisionStatus.postgres ? 'ok' : 'fail')} />
          <TelemetryRow label="Schema migrations" status={provisionStatus.loading ? 'pending' : ((provisionStatus.migrationsApplied ?? 0) > 0 ? 'ok' : (provisionStatus.schemaVersion && provisionStatus.schemaVersion > 0 ? 'ok' : 'fail'))} />
          <TelemetryRow label="Apache AGE graph" status={provisionStatus.loading ? 'pending' : (provisionStatus.ageAvailable ? 'ok' : 'warn')} />
        </Box>

        {provisionMode === 'cloud' && !provisionStatus.ageAvailable && !provisionStatus.loading && (
          <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mt: 2, fontSize: '0.7rem', bgcolor: `${crewTheme.accent.alert}15`, border: `1px solid ${crewTheme.accent.alert}40`, color: colors.text.primary }}>
            This cloud PostgreSQL does not have Apache AGE. Graph walks will use the recursive-CTE fallback; some features may be slower.
          </Alert>
        )}
      </Box>

      {/* ── PostgreSQL Connection ── */}
      <Box sx={{ ...cardSx, mb: 2 }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.text.primary, mb: 1.5 }}>
          PostgreSQL Connection
        </Typography>
        <TextField size="small" fullWidth placeholder="postgresql://user:password@host:5432/agentx"
          value={pgConnStr} onChange={(e) => { setPgConnStr(e.target.value); setTestResult(null); }} sx={{ mb: 1.5 }}
          slotProps={{ input: { sx: { fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace" } } }} />
        <Box sx={{ display: 'flex', gap: 1, mb: testResult ? 1.5 : 0 }}>
          <Button variant="outlined" onClick={handleTest} disabled={testing || !pgConnStr}
            sx={{ fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', borderColor: colors.border.default, color: colors.text.secondary, '&:hover': { borderColor: colors.border.strong } }}>
            {testing ? <CircularProgress size={14} sx={{ color: colors.text.secondary }} /> : 'Test Connection'}
          </Button>
          <Button variant="contained" onClick={handleSwitch} disabled={switching || !pgConnStr || !!(testResult && !testResult.ok)}
            sx={{ fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textTransform: 'none', bgcolor: colors.text.primary, color: colors.bg.primary, '&:hover': { bgcolor: '#ddd' } }}>
            {switching ? <CircularProgress size={14} sx={{ color: colors.bg.primary }} /> : 'Update Connection'}
          </Button>
        </Box>
        {testResult && (
          <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ fontSize: '0.7rem', py: 0 }}>
            {testResult.ok ? `Connected · ${testResult.version || 'PostgreSQL'} · ${testResult.latencyMs}ms ${testResult.tablesCreated ? `· Created ${testResult.tablesCreated} tables` : '· Schema ready'}` : testResult.error}
          </Alert>
        )}
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, mt: 1, lineHeight: 1.5 }}>
          Your credentials & API keys stay in local encrypted config files. Sessions, messages, memories, and domain data live in PostgreSQL.
        </Typography>
      </Box>

      {/* ── DB Stats ── */}
      <Box sx={{ ...cardSx, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.text.primary }}>Database Stats</Typography>
          <Button size="small" startIcon={<RefreshIcon sx={{ fontSize: 14 }} />} onClick={load}
            sx={{ fontSize: '0.65rem', color: colors.text.secondary, textTransform: 'none', fontFamily: "'JetBrains Mono', monospace" }}>Refresh</Button>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <StatItem label="Size" value={dbStatus?.stats.dbSizeFormatted || '—'} />
          <StatItem label="Tables" value={String(dbStatus?.stats.tableCount || 0)} />
          {dbStatus?.health && (
            <StatItem label="Health" value={dbStatus.health.status === 'healthy' ? '✓ Good' : '⚠ Issues'}
              color={dbStatus.health.status === 'healthy' ? colors.accent.green : colors.accent.orange} />
          )}
          <StatItem label="Sessions" value={String(dbStatus?.stats.tables?.['sessions'] ?? 0)} />
          <StatItem label="Messages" value={String(dbStatus?.stats.tables?.['messages'] ?? 0)} />
          <StatItem label="Memories" value={String(dbStatus?.stats.tables?.['crew_memories'] ?? 0)} />
        </Box>
        <Box sx={{ mt: 2 }}>
          <Button variant="outlined" onClick={handleMigrate} disabled={migrating}
            sx={{ fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', borderColor: colors.border.default, color: colors.text.secondary, '&:hover': { borderColor: colors.border.strong } }}>
            {migrating ? <CircularProgress size={14} sx={{ color: colors.text.secondary }} /> : 'Run Schema Migration'}
          </Button>
          {migrateResult && (
            <Typography sx={{ fontSize: '0.65rem', color: migrateResult.includes('failed') ? colors.accent.red : colors.accent.green, mt: 1, fontFamily: "'JetBrains Mono', monospace" }}>
              {migrateResult}
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── File Storage ── */}
      <Box sx={{ ...cardSx, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <FolderIcon sx={{ fontSize: 18, color: colors.text.secondary }} />
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.text.primary }}>
            File Storage
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
          <FilePathRow label="Config" path={fs?.config.path ?? '~/.config/agentx'} size={fs?.config.sizeFormatted ?? '—'}
            desc="Provider configs, plugin registry, MCP/ACP settings, crew registry" />
          <FilePathRow label="Data" path={fs?.data.path ?? '~/.local/share/agentx'} size={fs?.data.sizeFormatted ?? '—'}
            desc="Session files, secret sauce (soul, memories, diary, identity)" />
          <FilePathRow label="Cache" path={fs?.cache.path ?? '~/.cache/agentx'} size={fs?.cache.sizeFormatted ?? '—'}
            desc="Temporary files, content cache, compaction buffers" />
        </Box>

        <Box sx={{ p: 2, borderRadius: 1, bgcolor: `${colors.text.dim}05`, border: `1px solid ${colors.border.default}`, mb: 2 }}>
          <Typography sx={{ fontSize: '0.58rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, lineHeight: 1.7, letterSpacing: '0.3px' }}>
            <span style={{ color: colors.accent.orange, fontWeight: 600 }}>⚠ TAMPER WARNING</span><br />
            Manually editing, deleting, or corrupting files in these directories can cause data loss, session breakage, or agent instability. Agent-X encrypts sensitive fields with your master key — altering ciphertext will permanently destroy those records. Always back up before touching anything here.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<CleaningServicesIcon />} onClick={handleClearCache} disabled={clearingCache}
            sx={{ fontSize: '0.68rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', borderColor: colors.border.default, color: colors.text.secondary, '&:hover': { borderColor: colors.border.strong } }}>
            {clearingCache ? <CircularProgress size={14} sx={{ color: colors.text.secondary }} /> : 'Clear Logs & Cache'}
          </Button>
          {cacheResult && (
            <Typography sx={{ fontSize: '0.65rem', color: colors.accent.green, alignSelf: 'center', fontFamily: "'JetBrains Mono', monospace" }}>
              {cacheResult}
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── RAG Studio Storage ── */}
      <RagStudioStorageCard />

      {/* ── Soft Reset ── */}
      <Box sx={{ ...cardSx, mb: 2, border: `1px solid ${colors.accent.orange}20`, bgcolor: `${colors.accent.orange}05` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <RestartAltIcon sx={{ fontSize: 18, color: colors.accent.orange }} />
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.accent.orange }}>
            Soft Reset
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, mb: 2, lineHeight: 1.6 }}>
          Clears all domain data — sessions, messages, memories, crews, plugins, token logs, permissions, and tool executions. Your credentials, API keys, auth tokens, and provider configuration remain intact. You stay logged in.
        </Typography>
        <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={handleSoftReset} disabled={clearing}
          sx={{ borderColor: colors.accent.orange, color: colors.accent.orange, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none',
            '&:hover': { borderColor: colors.accent.orange, bgcolor: `${colors.accent.orange}10` } }}>
          {clearing ? 'Clearing...' : 'Soft Reset'}
        </Button>
      </Box>

      {/* ── Clear Domain Data ── */}
      <Box sx={{ ...dangerCardSx, mb: 2 }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.accent.red, mb: 1 }}>Clear Domain Data</Typography>
        <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, mb: 2, lineHeight: 1.6 }}>
          Same as Soft Reset but with explicit confirmation. Erases all domain data while keeping credentials and auth.
        </Typography>
        <Button variant="outlined" startIcon={<DeleteOutlineIcon />} onClick={() => setClearOpen(true)} disabled={clearing}
          sx={{ borderColor: colors.accent.red, color: colors.accent.red, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none',
            '&:hover': { borderColor: colors.accent.red, bgcolor: `${colors.accent.red}10` } }}>
          {clearing ? 'Clearing...' : 'Clear Domain Data'}
        </Button>
      </Box>

      {/* ── Factory Reset ── */}
      <Box sx={{ ...dangerCardSx, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <WarningAmberIcon sx={{ fontSize: 18, color: colors.accent.red }} />
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.accent.red }}>Factory Reset</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, mb: 2, lineHeight: 1.6 }}>
          Irreversibly deletes all local files, domain data, and credentials. This logs you out and wipes the agent. Use only when you want a completely fresh install.
        </Typography>
        <Button variant="outlined" onClick={() => setResetOpen(true)} disabled={resetting}
          sx={{ borderColor: colors.accent.red, color: colors.accent.red, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none',
            '&:hover': { borderColor: colors.accent.red, bgcolor: `${colors.accent.red}10` } }}>
          {resetting ? <CircularProgress size={14} sx={{ color: colors.accent.red }} /> : 'Factory Reset'}
        </Button>
      </Box>

      <Dialog open={clearOpen} onClose={() => setClearOpen(false)} PaperProps={{ sx: { bgcolor: colors.bg.primary, border: `1px solid ${colors.border.default}` } }}>
        <DialogTitle sx={{ fontSize: '0.85rem', color: colors.text.primary }}>Confirm Clear Domain Data</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 2 }}>
            Type <strong>DELETE</strong> to confirm. This removes sessions, messages, memories, crews, and plugins from PostgreSQL. Credentials and auth are preserved.
          </Typography>
          <TextField size="small" fullWidth value={clearConfirm} onChange={(e) => setClearConfirm(e.target.value)}
            placeholder="DELETE" sx={{ fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace" }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearOpen(false)} sx={{ fontSize: '0.7rem', color: colors.text.secondary }}>Cancel</Button>
          <Button onClick={handleClear} disabled={clearConfirm !== 'DELETE' || clearing} sx={{ fontSize: '0.7rem', color: colors.accent.red }}>
            {clearing ? 'Clearing...' : 'Clear'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} PaperProps={{ sx: { bgcolor: colors.bg.primary, border: `1px solid ${colors.border.default}` } }}>
        <DialogTitle sx={{ fontSize: '0.85rem', color: colors.text.primary }}>Confirm Factory Reset</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 2 }}>
            This will delete all local files, domain data, credentials, and API keys. You will be logged out. Type <strong>RESET</strong> to confirm.
          </Typography>
          {resetError && <Alert severity="error" sx={{ fontSize: '0.7rem', mb: 1 }}>{resetError}</Alert>}
          <TextField size="small" fullWidth value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)}
            placeholder="RESET" sx={{ fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace" }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)} sx={{ fontSize: '0.7rem', color: colors.text.secondary }}>Cancel</Button>
          <Button onClick={handleFactoryReset} disabled={resetConfirm !== 'RESET' || resetting} sx={{ fontSize: '0.7rem', color: colors.accent.red }}>
            {resetting ? 'Resetting...' : 'Reset Everything'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function TelemetryRow({ label, status }: { label: string; status: 'ok' | 'warn' | 'fail' | 'pending' }) {
  const icon = status === 'ok' ? <CheckCircleIcon sx={{ fontSize: 16, color: colors.accent.green }} />
    : status === 'warn' ? <WarningAmberIcon sx={{ fontSize: 16, color: colors.accent.orange }} />
    : status === 'fail' ? <ErrorIcon sx={{ fontSize: 16, color: colors.accent.red }} />
    : <HelpIcon sx={{ fontSize: 16, color: colors.text.secondary }} />;
  const text = status === 'ok' ? 'OK' : status === 'warn' ? 'Warning' : status === 'fail' ? 'Failed' : 'Checking';
  const color = status === 'ok' ? colors.accent.green : status === 'warn' ? colors.accent.orange : status === 'fail' ? colors.accent.red : colors.text.secondary;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5, borderBottom: `1px solid ${colors.border.default}` }}>
      <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {icon}
        <Typography sx={{ fontSize: '0.65rem', color, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{text}</Typography>
      </Box>
    </Box>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: `${colors.text.dim}05`, border: `1px solid ${colors.border.default}` }}>
      <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, mb: 0.5, fontFamily: "'JetBrains Mono', monospace" }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.75rem', color: color || colors.text.primary, fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}

function FilePathRow({ label, path, size, desc }: { label: string; path: string; size: string; desc: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
      <Box>
        <Typography sx={{ fontSize: '0.65rem', color: colors.text.primary, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>{path}</Typography>
        <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.3 }}>{desc}</Typography>
      </Box>
      <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{size}</Typography>
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
    <Box sx={{ ...cardSx, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <StorageIcon sx={{ fontSize: 18, color: colors.text.secondary }} />
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.text.primary }}>
          RAG Studio Storage
        </Typography>
      </Box>

      <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, mb: 2, lineHeight: 1.5 }}>
        Original copies of documents uploaded via RAG Studio are kept here so you can re-download or re-ingest them. Clearing this folder does NOT delete the knowledge entries already in the neural brain.
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={18} sx={{ color: colors.text.secondary }} />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          <StatItem label="Files" value={stats ? String(stats.fileCount) : '—'} />
          <StatItem label="Total Size" value={stats ? formatBytes(stats.totalBytes) : '—'} />
        </Box>
      )}

      {stats && stats.fileCount > 0 && (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <Button
            variant="outlined"
            startIcon={<DeleteOutlineIcon />}
            onClick={() => setConfirmOpen(true)}
            disabled={clearing}
            sx={{
              fontSize: '0.68rem',
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'none',
              borderColor: colors.accent.red + '40',
              color: colors.accent.red,
              '&:hover': { borderColor: colors.accent.red },
            }}
          >
            {clearing ? <CircularProgress size={14} sx={{ color: colors.accent.red }} /> : 'Clear RAG Studio Files'}
          </Button>
          {result && (
            <Typography sx={{ fontSize: '0.65rem', color: colors.accent.green, fontFamily: "'JetBrains Mono', monospace" }}>
              {result}
            </Typography>
          )}
        </Box>
      )}

      {confirmOpen && (
        <Box sx={{ mt: 2, p: 2, borderRadius: 1, bgcolor: `${colors.accent.red}08`, border: `1px solid ${colors.accent.red}30` }}>
          <Typography sx={{ fontSize: '0.68rem', color: colors.text.secondary, mb: 1.5 }}>
            Are you sure? This will delete all original file copies. Knowledge entries in the neural brain will remain.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" onClick={() => setConfirmOpen(false)} sx={{ fontSize: '0.65rem', color: colors.text.secondary }}>Cancel</Button>
            <Button size="small" variant="contained" onClick={handleClear} disabled={clearing}
              sx={{ fontSize: '0.65rem', bgcolor: colors.accent.red, '&:hover': { bgcolor: colors.accent.red + 'cc' } }}>
              {clearing ? 'Clearing…' : 'Yes, Delete Files'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
