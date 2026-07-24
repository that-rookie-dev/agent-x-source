import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { system, type WorkspaceInfo, type WorkspaceMigrateMode } from '../../api';
import { FolderPickerModal } from '../FolderPickerModal';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import {
  settingsHelperSx,
  settingsMonoSx,
  settingsBtnGhostSx,
  settingsDialogPaperSx,
  settingsDialogTitleSx,
} from '../../styles/settings-theme';

interface Props {
  /** Compact layout for setup wizard (no SettingsCard chrome). */
  compact?: boolean;
  /** Skip the Workspace section header (e.g. when nested under General). */
  embedded?: boolean;
  /**
   * Wizard mode: only expose “Choose folder…” — built-in path is a silent fallback,
   * not a selectable option.
   */
  chooseOnly?: boolean;
  onChanged?: (info: WorkspaceInfo) => void;
  /** Fired when readiness changes (true = non-builtin folder selected). */
  onReadyChange?: (ready: boolean) => void;
}

export function WorkspaceCard({ compact, embedded, chooseOnly, onChanged, onReadyChange }: Props) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [mode, setMode] = useState<WorkspaceMigrateMode>('copy');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const w = await system.workspace();
      setInfo(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (loading) return;
    onReadyChange?.(Boolean(info && !info.isBuiltin && info.path));
  }, [loading, info, onReadyChange]);

  const applyPath = async (path: string, migrateMode: WorkspaceMigrateMode) => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const result = await system.setWorkspace(path, migrateMode);
      setInfo(result);
      onChanged?.(result);
      const migrateNote = result.migrated && result.migrated > 0
        ? ` Migrated ${result.migrated} item(s).`
        : '';
      setStatus(`Workspace updated.${migrateNote}`);
      setPendingPath(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update workspace');
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <>
      {!chooseOnly && (
        <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
          All chats and tools work inside this single folder. Choose your own project folder anytime —
          the built-in app-data folder is only used as a fallback if the chosen path is missing.
        </Typography>
      )}

      {loading && (
        <Typography sx={{ ...settingsMonoSx, fontSize: '0.7rem' }}>Loading…</Typography>
      )}

      {!loading && info && !chooseOnly && (
        <Box
          sx={{
            mb: 1.5,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 1.5,
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', mb: 0.5, letterSpacing: '0.5px' }}>
              CURRENT {info.isBuiltin ? '· BUILT-IN FALLBACK' : '· WORKSPACE'}
            </Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', wordBreak: 'break-all' }}>
              {info.path}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FolderOpenIcon sx={{ fontSize: 14 }} />}
            onClick={() => setPickerOpen(true)}
            disabled={saving}
            sx={{ ...settingsBtnGhostSx, flexShrink: 0, mt: 0.15 }}
          >
            Choose folder…
          </Button>
        </Box>
      )}

      {!loading && chooseOnly && (
        <Box sx={{ mb: compact ? 0 : 1.5 }}>
          {info && !info.isBuiltin && (
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', wordBreak: 'break-all', mb: 1 }}>
              {info.path}
            </Typography>
          )}
          {info?.isBuiltin && (
            <Typography sx={{ ...settingsHelperSx, mb: 1, fontSize: '0.65rem' }}>
              Choose a project folder to continue.
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<FolderOpenIcon sx={{ fontSize: 14 }} />}
              onClick={() => setPickerOpen(true)}
              disabled={saving}
              sx={settingsBtnGhostSx}
            >
              Choose folder…
            </Button>
            {saving && (
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: 'text.secondary' }}>
                Updating…
              </Typography>
            )}
            {!saving && status && (
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: 'success.main' }}>
                {status}
              </Typography>
            )}
            {!saving && error && (
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: 'error.main' }}>
                {error}
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {!chooseOnly && error && <Alert severity="error" sx={{ mb: 1.5, py: 0.5 }}>{error}</Alert>}
      {!chooseOnly && status && <Alert severity="success" sx={{ mb: 1.5, py: 0.5 }}>{status}</Alert>}

      {!loading && !info && !chooseOnly && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<FolderOpenIcon sx={{ fontSize: 14 }} />}
          onClick={() => setPickerOpen(true)}
          disabled={saving}
          sx={settingsBtnGhostSx}
        >
          Choose folder…
        </Button>
      )}

      <FolderPickerModal
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onSelect={(path) => {
          setPickerOpen(false);
          // First selection from built-in fallback — nothing to migrate yet.
          if (!info || info.isBuiltin) {
            void applyPath(path, 'switch');
            return;
          }
          setPendingPath(path);
          setMode('copy');
        }}
      />

      <Dialog
        open={!!pendingPath}
        onClose={() => !saving && setPendingPath(null)}
        PaperProps={{ sx: settingsDialogPaperSx }}
      >
        <DialogTitle sx={settingsDialogTitleSx}>Change workspace</DialogTitle>
        <DialogContent>
          <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
            New location:
          </Typography>
          <Typography sx={{ ...settingsMonoSx, fontSize: '0.7rem', mb: 2, wordBreak: 'break-all' }}>
            {pendingPath}
          </Typography>
          <Typography sx={{ ...settingsHelperSx, mb: 1 }}>
            What should happen to files in the current workspace?
          </Typography>
          <RadioGroup
            value={mode}
            onChange={(_, v) => setMode(v as WorkspaceMigrateMode)}
          >
            <FormControlLabel value="copy" control={<Radio size="small" />} label="Copy everything to the new folder" />
            <FormControlLabel value="move" control={<Radio size="small" />} label="Move everything to the new folder" />
            <FormControlLabel value="switch" control={<Radio size="small" />} label="Switch only — leave current files where they are" />
          </RadioGroup>
        </DialogContent>
        <DialogActions>
          <Button size="small" variant="outlined" onClick={() => setPendingPath(null)} disabled={saving} sx={settingsBtnGhostSx}>Cancel</Button>
          <Button
            size="small"
            variant="outlined"
            disabled={saving || !pendingPath}
            onClick={() => pendingPath && void applyPath(pendingPath, mode)}
            sx={settingsBtnGhostSx}
          >
            {saving ? 'Updating…' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );

  if (compact) {
    return <Box>{body}</Box>;
  }

  const card = (
    <SettingsCard title="Workspace" subtitle="Single folder for all Agent-X file access">
      {body}
    </SettingsCard>
  );

  if (embedded) {
    return card;
  }

  return (
    <>
      <SettingsSectionHeader
        icon={<FolderOpenIcon sx={{ fontSize: 16 }} />}
        title="Workspace"
        subtitle="Single folder for all Agent-X file access"
      />
      {card}
    </>
  );
}
