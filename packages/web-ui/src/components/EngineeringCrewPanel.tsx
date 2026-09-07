import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import EngineeringIcon from '@mui/icons-material/Engineering';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import BlockIcon from '@mui/icons-material/Block';
import BuildCircleIcon from '@mui/icons-material/BuildCircle';
import { PanelHeader } from './PanelHeader';
import { engineeringCrew, type EngineeringCrewRun, type EngineeringCrewPhase, type EngineeringCrewVerification } from '../api';
import { colors, alphaColor } from '../theme';

const POLL_INTERVAL_MS = 5000;

function statusColor(status: string): string {
  switch (status) {
    case 'verified':
    case 'complete':
      return colors.accent.green;
    case 'failed':
      return colors.accent.red;
    case 'blocked':
      return colors.accent.orange;
    case 'in_progress':
      return colors.accent.blue;
    default:
      return colors.text.dim;
  }
}

function StatusIcon({ status, size = 16 }: { status: string; size?: number }) {
  switch (status) {
    case 'verified':
    case 'complete':
      return <CheckCircleIcon sx={{ fontSize: size, color: statusColor(status) }} />;
    case 'failed':
      return <ErrorIcon sx={{ fontSize: size, color: statusColor(status) }} />;
    case 'blocked':
      return <BlockIcon sx={{ fontSize: size, color: statusColor(status) }} />;
    case 'in_progress':
      return <BuildCircleIcon sx={{ fontSize: size, color: statusColor(status) }} />;
    default:
      return <PendingIcon sx={{ fontSize: size, color: statusColor(status) }} />;
  }
}

function PhaseRow({ phase, taskId }: { phase: EngineeringCrewPhase; taskId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [verification, setVerification] = useState<EngineeringCrewVerification[] | null>(null);
  const [loadingV, setLoadingV] = useState(false);

  const loadVerification = useCallback(async () => {
    if (verification || loadingV) return;
    setLoadingV(true);
    try {
      const result = await engineeringCrew.getVerification(taskId, phase.id);
      setVerification(result.verification);
    } catch {
      setVerification(phase.verification ?? []);
    } finally {
      setLoadingV(false);
    }
  }, [taskId, phase.id, phase.verification, verification, loadingV]);

  const toggleExpand = () => {
    if (!expanded && !verification) void loadVerification();
    setExpanded(!expanded);
  };

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        onClick={toggleExpand}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          cursor: 'pointer',
          py: 0.75,
          px: 1,
          borderRadius: 1,
          '&:hover': { bgcolor: alphaColor(colors.text.primary, '05') },
        }}
      >
        {expanded ? <ExpandMoreIcon sx={{ fontSize: 16, color: colors.text.dim }} /> : <ChevronRightIcon sx={{ fontSize: 16, color: colors.text.dim }} />}
        <StatusIcon status={phase.status} />
        <Typography sx={{ fontSize: '0.75rem', color: colors.text.primary, flex: 1 }}>
          {phase.title}
        </Typography>
        <Chip
          label={phase.status}
          size="small"
          sx={{
            fontSize: '0.6rem',
            height: 18,
            bgcolor: alphaColor(statusColor(phase.status), '15'),
            color: statusColor(phase.status),
            border: 'none',
          }}
        />
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ pl: 4, pr: 1, py: 1 }}>
          {/* Acceptance criteria */}
          <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Acceptance Criteria
          </Typography>
          {phase.acceptanceCriteria.length === 0 ? (
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, fontStyle: 'italic', mb: 1 }}>(none specified)</Typography>
          ) : (
            <Box sx={{ mb: 1 }}>
              {phase.acceptanceCriteria.map((criterion, i) => {
                const outcome = verification?.find((v) => v.criterion === criterion || v.criterion.startsWith(criterion));
                return (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.25 }}>
                    {outcome ? (
                      <StatusIcon status={outcome.passed ? 'verified' : 'failed'} size={12} />
                    ) : (
                      <PendingIcon sx={{ fontSize: 12, color: colors.text.dim }} />
                    )}
                    <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, flex: 1 }}>
                      {criterion}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}

          {/* Verification evidence */}
          {verification && verification.length > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Verification Evidence
              </Typography>
              {verification.map((v, i) => (
                <Box key={i} sx={{ mb: 0.5, p: 0.75, borderRadius: 0.5, bgcolor: alphaColor(colors.bg.primary, '50') }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                    <StatusIcon status={v.passed ? 'verified' : 'failed'} size={12} />
                    <Typography sx={{ fontSize: '0.65rem', color: v.passed ? colors.accent.green : colors.accent.red, fontWeight: 600 }}>
                      {v.passed ? 'PASS' : 'FAIL'}
                    </Typography>
                    {v.exitCode !== undefined && (
                      <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>
                        exit={v.exitCode}
                      </Typography>
                    )}
                  </Box>
                  <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, mb: 0.25 }}>
                    {v.criterion}
                  </Typography>
                  {v.detail && (
                    <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                      {v.detail}
                    </Typography>
                  )}
                  {v.command && (
                    <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.25 }}>
                      $ {v.command}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {/* Unknowns */}
          {phase.unknowns.length > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Unknowns
              </Typography>
              {phase.unknowns.map((u, i) => (
                <Box key={i} sx={{ mb: 0.5, display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                  <Chip
                    label={u.escalated && !u.resolution ? 'BLOCKED' : u.resolution ? 'RESOLVED' : 'OPEN'}
                    size="small"
                    sx={{
                      fontSize: '0.55rem',
                      height: 14,
                      bgcolor: alphaColor(u.escalated && !u.resolution ? colors.accent.red : u.resolution ? colors.accent.green : colors.accent.orange, '15'),
                      color: u.escalated && !u.resolution ? colors.accent.red : u.resolution ? colors.accent.green : colors.accent.orange,
                    }}
                  />
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary }}>{u.question}</Typography>
                    {u.resolution && (
                      <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, mt: 0.25 }}>
                        → {u.resolution}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* Implementation notes */}
          {phase.implementationNotes && (
            <Box>
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Implementation Notes
              </Typography>
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre-wrap' }}>
                {phase.implementationNotes}
              </Typography>
            </Box>
          )}

          {loadingV && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <CircularProgress size={12} sx={{ color: colors.text.dim }} />
              <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim }}>Loading verification…</Typography>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function RunCard({ run, onRefresh }: { run: EngineeringCrewRun; onRefresh?: () => void }) {
  const [expanded, setExpanded] = useState(run.status === 'in_progress' || run.status === 'blocked');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const canResume = run.status === 'blocked' || run.status === 'in_progress' || run.status === 'failed' || run.status === 'timed_out';

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(true);
    setActionError('');
    try {
      await engineeringCrew.resumeRun(run.taskId);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Resume failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete crew run "${run.taskId}"? This cannot be undone.`)) return;
    setActionLoading(true);
    setActionError('');
    try {
      await engineeringCrew.deleteRun(run.taskId);
      onRefresh?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <Box sx={{ mb: 1.5, border: `1px solid ${colors.border.default}`, borderRadius: 1, overflow: 'hidden' }}>
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          py: 1,
          px: 1.5,
          cursor: 'pointer',
          bgcolor: alphaColor(colors.bg.primary, '30'),
          '&:hover': { bgcolor: alphaColor(colors.bg.primary, '50') },
        }}
      >
        {expanded ? <ExpandMoreIcon sx={{ fontSize: 16, color: colors.text.dim }} /> : <ChevronRightIcon sx={{ fontSize: 16, color: colors.text.dim }} />}
        <StatusIcon status={run.status} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.objective || run.taskId}
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
            {run.taskId}
          </Typography>
        </Box>
        <Chip
          label={run.status}
          size="small"
          sx={{
            fontSize: '0.6rem',
            height: 18,
            bgcolor: alphaColor(statusColor(run.status), '15'),
            color: statusColor(run.status),
            border: 'none',
          }}
        />
        <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>
          {run.phases.length} phase{run.phases.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ p: 1 }}>
          {/* #4: Resume and Delete action buttons */}
          {(canResume || run.status !== 'complete') && (
            <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
              {canResume && (
                <Chip
                  label={actionLoading ? 'Working…' : 'Resume'}
                  size="small"
                  onClick={handleResume}
                  disabled={actionLoading}
                  sx={{ fontSize: '0.6rem', height: 20, bgcolor: alphaColor(colors.accent.blue, '15'), color: colors.accent.blue, border: 'none', cursor: 'pointer' }}
                />
              )}
              <Chip
                label="Delete"
                size="small"
                onClick={handleDelete}
                disabled={actionLoading}
                sx={{ fontSize: '0.6rem', height: 20, bgcolor: alphaColor(colors.accent.red, '15'), color: colors.accent.red, border: 'none', cursor: 'pointer' }}
              />
            </Box>
          )}
          {actionError && (
            <Alert severity="error" sx={{ mb: 1, fontSize: '0.65rem' }}>{actionError}</Alert>
          )}
          {run.phases.length === 0 ? (
            <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, fontStyle: 'italic', p: 1 }}>
              No phases in this run.
            </Typography>
          ) : (
            run.phases.map((phase) => <PhaseRow key={phase.id} phase={phase} taskId={run.taskId} />)
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

export function EngineeringCrewPanel() {
  const [runs, setRuns] = useState<EngineeringCrewRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async () => {
    try {
      const r = await engineeringCrew.listRuns();
      setRuns(r);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Engineering Crew runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    const id = setInterval(loadRuns, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadRuns]);

  const completedCount = runs.filter((r) => r.status === 'complete').length;
  const blockedCount = runs.filter((r) => r.status === 'blocked').length;
  const inProgressCount = runs.filter((r) => r.status === 'in_progress').length;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelHeader
        title="Engineering Crew"
        subtitle="Software engineering pipeline — Architect → Coder ⇄ Verifier → Reviewer"
        icon={<EngineeringIcon sx={{ fontSize: 18, color: colors.accent.blue }} />}
        action={
          <IconButton onClick={loadRuns} size="small" sx={{ color: colors.text.dim }}>
            <RefreshIcon sx={{ fontSize: 16 }} />
          </IconButton>
        }
      />

      <Box sx={{ flex: 1, overflow: 'auto', p: 1.5 }}>
        {/* Summary stats */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Box sx={{ flex: 1, p: 1, borderRadius: 1, border: `1px solid ${colors.border.default}`, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: colors.accent.green }}>{completedCount}</Typography>
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>Complete</Typography>
          </Box>
          <Box sx={{ flex: 1, p: 1, borderRadius: 1, border: `1px solid ${colors.border.default}`, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: colors.accent.blue }}>{inProgressCount}</Typography>
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>In Progress</Typography>
          </Box>
          <Box sx={{ flex: 1, p: 1, borderRadius: 1, border: `1px solid ${colors.border.default}`, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: colors.accent.orange }}>{blockedCount}</Typography>
            <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim }}>Blocked</Typography>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, fontSize: '0.7rem' }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} sx={{ color: colors.text.dim }} />
          </Box>
        ) : runs.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <EngineeringIcon sx={{ fontSize: 40, color: colors.text.dim, mb: 1 }} />
            <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim, mb: 0.5 }}>
              No Engineering Crew runs yet.
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim }}>
              Substantial software-engineering tasks will appear here with their plan, phases, and verification evidence.
            </Typography>
          </Box>
        ) : (
          runs.map((run) => <RunCard key={run.taskId} run={run} onRefresh={loadRuns} />)
        )}
      </Box>
    </Box>
  );
}
