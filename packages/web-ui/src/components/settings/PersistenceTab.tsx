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
import { settings, factoryReset, setAuthToken, type DbStatus } from '../../api';
import { useApp } from '../../store/AppContext';
import { colors } from '../../theme';

const cardSx = {
  bgcolor: colors.bg.secondary,
  border: `1px solid ${colors.border.default}`,
  borderRadius: 1.5,
  p: 3,
};

const dangerCardSx = {
  ...cardSx,
  border: `1px solid ${colors.accent.red}20`,
  bgcolor: `${colors.accent.red}05`,
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await settings.db.get();
      setDbStatus(s);
      setPgConnStr(s.postgres?.connectionString || '');
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const handleSwitchToSqlite = async () => {
    setSwitching(true);
    try { await settings.db.update({ backend: 'sqlite' }); await load(); }
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

  const isSqlite = dbStatus?.backend === 'sqlite';
  const isPostgres = dbStatus?.backend === 'postgres';
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
          <Button variant={isSqlite ? 'contained' : 'outlined'} onClick={handleSwitchToSqlite} disabled={switching || isSqlite}
            sx={{ flex: 1, py: 1.5, fontSize: '0.78rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textTransform: 'none',
              bgcolor: isSqlite ? colors.text.primary : 'transparent', color: isSqlite ? colors.bg.primary : colors.text.secondary,
              borderColor: colors.border.default, '&:hover': { borderColor: colors.border.strong, bgcolor: isSqlite ? '#ddd' : undefined } }}>
            Native SQLite {isSqlite && '✓'}
          </Button>
          <Button variant={isPostgres ? 'contained' : 'outlined'} disabled={switching}
            sx={{ flex: 1, py: 1.5, fontSize: '0.78rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textTransform: 'none',
              bgcolor: isPostgres ? colors.text.primary : 'transparent', color: isPostgres ? colors.bg.primary : colors.text.secondary,
              borderColor: colors.border.default, '&:hover': { borderColor: colors.border.strong } }}>
            PostgreSQL {isPostgres && '✓'}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dbStatus?.connected ? colors.accent.green : colors.accent.red }} />
          <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary }}>
            {dbStatus?.connected ? 'Connected' : 'Disconnected'}
            {' · '}
            {isSqlite ? `domain.db · ${dbStatus?.stats.dbSizeFormatted || '—'}` : 'PostgreSQL'}
          </Typography>
        </Box>
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
          {isSqlite && (
            <Button variant="contained" onClick={handleSwitch} disabled={switching || !pgConnStr || !!(testResult && !testResult.ok)}
              sx={{ fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, textTransform: 'none', bgcolor: colors.text.primary, color: colors.bg.primary, '&:hover': { bgcolor: '#ddd' } }}>
              {switching ? <CircularProgress size={14} sx={{ color: colors.bg.primary }} /> : 'Switch & Migrate'}
            </Button>
          )}
        </Box>
        {testResult && (
          <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ fontSize: '0.7rem', py: 0 }}>
            {testResult.ok ? `Connected · ${testResult.version || 'PostgreSQL'} · ${testResult.latencyMs}ms ${testResult.tablesCreated ? `· Created ${testResult.tablesCreated} tables` : '· Schema ready'}` : testResult.error}
          </Alert>
        )}
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, mt: 1, lineHeight: 1.5 }}>
          Your credentials & API keys always stay in local SQLite. Only sessions, messages, memories, and domain data go to PostgreSQL.
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
        {isSqlite && !isPostgres && pgConnStr && testResult?.ok && (
          <Box sx={{ mt: 2 }}>
            <Button variant="outlined" onClick={handleMigrate} disabled={migrating}
              sx={{ fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', borderColor: colors.border.default, color: colors.text.secondary, '&:hover': { borderColor: colors.border.strong } }}>
              {migrating ? <CircularProgress size={14} sx={{ color: colors.text.secondary }} /> : 'Migrate Data to PostgreSQL'}
            </Button>
            {migrateResult && (
              <Typography sx={{ fontSize: '0.65rem', color: migrateResult.includes('failed') ? colors.accent.red : colors.accent.green, mt: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                {migrateResult}
              </Typography>
            )}
          </Box>
        )}
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
            desc="SQLite database, session files, secret sauce (soul, memories, diary, identity)" />
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
        <Button variant="outlined" startIcon={<DeleteOutlineIcon />} onClick={() => setClearOpen(true)}
          sx={{ borderColor: colors.accent.red, color: colors.accent.red, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none',
            '&:hover': { borderColor: colors.accent.red, bgcolor: `${colors.accent.red}10` } }}>
          Clear Domain Data...
        </Button>
      </Box>

      {/* ── Factory Reset ── */}
      <Box sx={{ ...dangerCardSx, mb: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <WarningAmberIcon sx={{ fontSize: 18, color: colors.accent.red }} />
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.accent.red }}>
            Factory Reset
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, mb: 2, lineHeight: 1.6 }}>
          Permanently erase everything — configuration, credentials, API keys, all sessions, messages, memories, plugins, preferences, and logs. You will be signed out and redirected to setup.
        </Typography>
        <Button variant="outlined" startIcon={<WarningAmberIcon />} onClick={() => setResetOpen(true)}
          sx={{ borderColor: colors.accent.red, color: colors.accent.red, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none',
            '&:hover': { borderColor: colors.accent.red, bgcolor: `${colors.accent.red}10` } }}>
          Factory Reset...
        </Button>
      </Box>

      {/* Clear Domain Data Dialog */}
      <ConfirmDialog open={clearOpen} title="Clear Domain Data" confirmLabel="CLEAR"
        message="This will permanently delete all domain data:"
        items={[
          `Sessions (${dbStatus?.stats.tables?.['sessions'] ?? 0}) and messages (${dbStatus?.stats.tables?.['messages'] ?? 0})`,
          'Crews, memories, and diary entries',
          'Token logs, permissions, and tool executions',
          'Session context and todos',
        ]}
        note="Your credentials, API keys, and auth session remain safe."
        confirm={clearConfirm} setConfirm={setClearConfirm}
        loading={clearing} loadingText="Clearing..."
        actionText="Clear All Domain Data" onAction={handleClear}
        onClose={() => { if (!clearing) { setClearOpen(false); setClearConfirm(''); } }} />

      {/* Factory Reset Dialog */}
      <ConfirmDialog open={resetOpen} title="Factory Reset" confirmLabel="RESET"
        message="This will permanently delete everything stored locally:"
        items={[
          'Authentication credentials and active sessions',
          'Provider API keys and model configurations',
          'All chat history, conversations, and message logs',
          'Crew definitions and orchestration settings',
          'User preferences and UI settings',
          'All log files and cached data',
        ]}
        note="This cannot be undone. You will need to reconfigure Agent-X from scratch."
        error={resetError}
        confirm={resetConfirm} setConfirm={setResetConfirm}
        loading={resetting} loadingText="Deleting..."
        actionText="Delete Everything" onAction={handleFactoryReset}
        onClose={() => { if (!resetting) { setResetOpen(false); setResetConfirm(''); setResetError(''); } }} />
    </Box>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: color || colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>{value}</Typography>
    </Box>
  );
}

function FilePathRow({ label, path, size, desc }: { label: string; path: string; size: string; desc: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
      <FolderIcon sx={{ fontSize: 15, color: colors.text.dim, mt: '1px', flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', color: colors.accent.blue, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
            {size}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", wordBreak: 'break-all', mb: 0.25 }}>
          {path}
        </Typography>
        <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, lineHeight: 1.4 }}>
          {desc}
        </Typography>
      </Box>
    </Box>
  );
}

function ConfirmDialog({ open, title, confirmLabel, message, items, note, error, confirm, setConfirm, loading, loadingText, actionText, onAction, onClose }: {
  open: boolean; title: string; confirmLabel: string; message: string; items: string[];
  note?: string; error?: string;
  confirm: string; setConfirm: (v: string) => void;
  loading: boolean; loadingText: string; actionText: string;
  onAction: () => void; onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}` } }}>
      <DialogTitle sx={{ fontSize: '0.9rem', fontWeight: 700, pb: 1 }}>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: '0.75rem', color: colors.text.secondary, mb: 2, lineHeight: 1.7 }}>{message}</Typography>
        <Box component="ul" sx={{ m: 0, pl: 2, mb: 2, fontSize: '0.7rem', color: colors.text.dim, lineHeight: 2.1 }}>
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </Box>
        {note && (
          <Typography sx={{ fontSize: '0.75rem', color: colors.accent.red, fontWeight: 600, mb: 1.5 }}>{note}</Typography>
        )}
        {error && <Alert severity="error" sx={{ mb: 1.5, fontSize: '0.7rem' }}>{error}</Alert>}
        <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 1 }}>
          Type <strong style={{ color: colors.text.primary }}>{confirmLabel}</strong> to confirm.
        </Typography>
        <TextField size="small" fullWidth value={confirm} onChange={(e) => setConfirm(e.target.value)}
          placeholder={`Type ${confirmLabel} to confirm`}
          slotProps={{ input: { sx: { fontSize: '0.75rem' } } }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading} sx={{ fontSize: '0.75rem', textTransform: 'none', color: colors.text.secondary }}>Cancel</Button>
        <Button onClick={onAction} disabled={confirm !== confirmLabel || loading} variant="contained"
          sx={{ bgcolor: colors.accent.red, color: '#fff', fontSize: '0.75rem', fontWeight: 600, textTransform: 'none',
            '&:hover': { bgcolor: '#d32f2f' }, '&.Mui-disabled': { bgcolor: `${colors.accent.red}40`, color: '#ffffff60' } }}>
          {loading ? loadingText : actionText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
