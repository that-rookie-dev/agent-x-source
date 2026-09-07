import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Button from '@mui/material/Button';
import Badge from '@mui/material/Badge';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Fade from '@mui/material/Fade';
import Grow from '@mui/material/Grow';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import DashboardIcon from '@mui/icons-material/Dashboard';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ListAltIcon from '@mui/icons-material/ListAlt';
import HelpIcon from '@mui/icons-material/Help';
import InsightsIcon from '@mui/icons-material/Insights';

import { PanelHeader } from './PanelHeader';
import {
  capabilities,
  type CapabilityAuditRecord,
  type CapabilityRecord,
  type CapabilityTestCaseRecord,
  type CapabilityUsageReportRecord,
  type GraduationGateRecord,
} from '../api';
import { colors, MONO, alphaColor } from '../theme';
import { PipelineOverview } from './synthetic/PipelineOverview';
import { ObservationFeed } from './synthetic/ObservationFeed';
import { ProposalReviewCard } from './synthetic/ProposalReviewCard';
import { CapabilityList } from './synthetic/CapabilityList';
import { CapabilityDetail } from './synthetic/CapabilityDetail';
import { ApprovalWorkflow } from './synthetic/ApprovalWorkflow';
import { BulkApprovalDialog } from './synthetic/BulkApprovalDialog';
import { BulkProposalActions } from './synthetic/BulkProposalActions';
import { CreateWizard } from './synthetic/CreateWizard';
import { ConsentDialog, type ConsentChoice } from './synthetic/ConsentDialog';
import { NotificationCenter } from './NotificationCenter';
import { TourGuide } from './TourGuide';
import { CapabilityDashboard } from './synthetic/CapabilityDashboard';
import { CapabilityHelp } from './synthetic/CapabilityHelp';
import { notify } from './NotificationToast';
import { useCapabilitySSE } from '../hooks/useCapabilities';
import type { CapabilitySsePayload } from '@agentx/shared';

type View = 'overview' | 'observed' | 'create' | 'proposals' | 'list' | 'detail' | 'help' | 'dashboard';

type ErrorCategory = 'store' | 'sandbox' | null;

function categorizeError(error: string | null | undefined): ErrorCategory {
  if (!error) return null;
  const lower = error.toLowerCase();
  if (/\b(store|storage|unavailable|database|postgres|connection|deadlock|serialization|econn|network)\b/i.test(lower)) {
    return 'store';
  }
  if (/\b(sandbox|timeout|timed out)\b/i.test(lower)) {
    return 'sandbox';
  }
  return null;
}

const TABS: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <DashboardIcon sx={{ fontSize: 16 }} /> },
  { id: 'observed', label: 'Observed', icon: <VisibilityIcon sx={{ fontSize: 16 }} /> },
  { id: 'create', label: 'Create', icon: <AddCircleIcon sx={{ fontSize: 16 }} /> },
  { id: 'proposals', label: 'Proposals', icon: <AssessmentIcon sx={{ fontSize: 16 }} /> },
  { id: 'list', label: 'Registry', icon: <ListAltIcon sx={{ fontSize: 16 }} /> },
  { id: 'dashboard', label: 'Dashboard', icon: <InsightsIcon sx={{ fontSize: 16 }} /> },
  { id: 'help', label: 'Help', icon: <HelpIcon sx={{ fontSize: 16 }} /> },
];

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Box
      sx={{
        flex: '1 1 120px',
        minWidth: 120,
        p: 1.25,
        border: `1px solid ${colors.border.strong}`,
        borderRadius: 1,
        bgcolor: alphaColor(colors.bg.tertiary, '30'),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: '1.35rem',
          fontWeight: 700,
          color: color ?? colors.text.primary,
          lineHeight: 1,
        }}
      >
        {value}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: colors.text.dim, textTransform: 'uppercase', letterSpacing: '0.08em', mt: 0.5 }}>
        {label}
      </Typography>
    </Box>
  );
}

export function SyntheticPanel() {
  const [view, setView] = useState<View>('overview');
  const [items, setItems] = useState<CapabilityRecord[]>([]);
  const [stats, setStats] = useState<{ total: number; byStatus: Record<string, number>; byKind: Record<string, number> }>({
    total: 0, byStatus: {}, byKind: {},
  });
  const [observations, setObservations] = useState<import('../api').ObservedPatternRecord[]>([]);
  const [selected, setSelected] = useState<CapabilityRecord | null>(null);
  const [gates, setGates] = useState<GraduationGateRecord[]>([]);
  const [audit, setAudit] = useState<CapabilityAuditRecord[]>([]);
  const [usage, setUsage] = useState<CapabilityUsageReportRecord | null>(null);
  const [testCases, setTestCases] = useState<CapabilityTestCaseRecord[]>([]);
  const [recent, setRecent] = useState<CapabilityAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<{ mode: 'approve' | 'reject'; id: string; name: string; sideEffects?: string[] } | null>(null);
  const [bulkDialog, setBulkDialog] = useState<{ open: boolean; ids: string[]; names: string[]; sideEffects: { name: string; effects: string[] }[] } | null>(null);
  const [consentDialog, setConsentDialog] = useState<{ open: boolean; patternId?: string; pattern?: string }>({ open: false });
  const [tourOpen, setTourOpen] = useState(false);
  const [proposalTab, setProposalTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await capabilities.list({ q: filter || undefined });
      setItems(data.capabilities);
      setStats(data.stats);
      const obs = await capabilities.observations().catch(() => ({ observations: [] }));
      setObservations(obs.observations);
      const settings = await capabilities.settings().catch(() => ({ settings: { generationConsent: 'always' as const, enabled: false } }));
      if (settings.settings.enabled && (settings.settings.generationConsent ?? 'unset') === 'unset') {
        setConsentDialog({ open: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capabilities');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const onSse = useCallback((payload: CapabilitySsePayload) => {
    void load();
    if (payload.event === 'capability:proposed' && payload.name) {
      notify('checkpoint', `New capability proposal: ${payload.name}`, {
        persist: true,
        onClick: () => setView('proposals'),
      });
    }
    if (payload.event === 'capability:sandbox-result') {
      notify(payload.passed ? 'checkpoint' : 'error', payload.passed ? `${payload.name} passed sandbox` : `${payload.name} failed sandbox`);
    }
    if (payload.event === 'capability:error' && (payload.reason === 'consent-required' || payload.reason === 'pattern-consent-required')) {
      setConsentDialog({
        open: true,
        patternId: payload.patternId,
        pattern: payload.pattern,
      });
    }
  }, [load]);
  useCapabilitySSE(onSse);

  const openDetail = useCallback(async (item: CapabilityRecord) => {
    setSelected(item);
    setView('detail');
    try {
      const detail = await capabilities.get(item.id);
      setSelected(detail.capability);
      setGates(detail.gates);
      setAudit(detail.audit);
      setUsage(detail.usage);
      setRecent(detail.audit.slice(-20).reverse());
      const cases = await capabilities.testCases(item.id).catch(() => ({ testCases: [] }));
      setTestCases(cases.testCases);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load capability');
    }
  }, []);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      if (selected) await openDetail(selected);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }, [selected, openDetail, load]);

  const pending = (stats.byStatus['proposed'] ?? 0) + (stats.byStatus['in-trial'] ?? 0);
  const proposals = useMemo(() => {
    if (proposalTab === 'all') return items;
    if (proposalTab === 'approved') return items.filter((i) => i.status === 'registered');
    if (proposalTab === 'rejected') return items.filter((i) => i.status === 'archived');
    return items.filter((i) => i.status === 'proposed' || i.status === 'sandbox-passed' || i.status === 'in-trial');
  }, [items, proposalTab]);

  const selectedVisibleProposalIds = useMemo(
    () => proposals.filter((i) => selectedProposalIds.has(i.id)).map((i) => i.id),
    [proposals, selectedProposalIds],
  );

  const exportCsv = () => {
    const header = 'name,kind,status,origin,useCount\n';
    const body = items.map((i) => `${i.name},${i.kind},${i.status},${i.origin},${i.useCount}`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'capabilities.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const action = (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      <Tooltip title="Pending proposals">
        <IconButton
          size="small"
          aria-label="Pending proposals"
          onClick={() => setView('proposals')}
          sx={{ color: colors.text.dim }}
        >
          <Badge badgeContent={pending} color="warning" max={99}>
            <AutoAwesomeIcon sx={{ fontSize: 18 }} />
          </Badge>
        </IconButton>
      </Tooltip>
      <NotificationCenter />
      <Tooltip title="Help">
        <IconButton size="small" aria-label="Capabilities help" onClick={() => setView('help')} sx={{ color: colors.text.dim }}>
          <HelpOutlineIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Tour">
        <IconButton size="small" aria-label="Start tour" onClick={() => setTourOpen(true)} sx={{ color: colors.text.dim }}>
          <HelpIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Refresh">
        <IconButton size="small" aria-label="Refresh capabilities" onClick={() => void load()} sx={{ color: colors.text.dim }}>
          <RefreshIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );

  const content = (() => {
    if (view === 'overview') {
      return (
        <PipelineOverview
          stats={stats}
          pending={pending}
          recent={recent}
          onFilter={(status) => { setFilter(status ?? ''); setView('list'); }}
          onReview={() => setView('proposals')}
          onOpenEvent={(id) => {
            const item = items.find((i) => i.id === id);
            if (item) void openDetail(item);
          }}
        />
      );
    }
    if (view === 'observed') {
      return (
        <ObservationFeed
          observations={observations}
          onAcknowledge={(id) => void act(() => capabilities.acknowledgeObservation(id))}
          onIgnore={(id) => void act(() => capabilities.ignoreObservation(id))}
          onGenerate={(id) => void act(async () => {
            const { proposal } = await capabilities.generateFromObservation(id);
            if (proposal) await openDetail(proposal.proposedCapability);
          })}
          onCreateFromPrompt={() => setView('create')}
          onFindSimilar={(pattern) => { setFilter(pattern); setView('list'); }}
        />
      );
    }
    if (view === 'create') return <CreateWizard onCreated={(cap) => void openDetail(cap)} />;
    if (view === 'help') return <CapabilityHelp />;
    if (view === 'dashboard') return <CapabilityDashboard />;
    if (view === 'proposals') {
      return (
        <>
          <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5, flexWrap: 'wrap' }}>
            {(['pending', 'approved', 'rejected', 'all'] as const).map((t) => (
              <Button
                key={t}
                size="small"
                onClick={() => setProposalTab(t)}
                sx={{
                  fontFamily: MONO,
                  textTransform: 'none',
                  fontSize: '0.65rem',
                  color: proposalTab === t ? colors.accent.blue : colors.text.dim,
                  bgcolor: proposalTab === t ? alphaColor(colors.accent.blue, '12') : 'transparent',
                  border: `1px solid ${proposalTab === t ? colors.accent.blue : colors.border.strong}`,
                  borderRadius: 1,
                  px: 1,
                  '&:hover': { borderColor: colors.accent.blue, color: colors.accent.blue },
                }}
              >
                {t}
              </Button>
            ))}
          </Box>
          <BulkProposalActions
            selected={selectedVisibleProposalIds}
            onBulk={async (ids, action) => {
              if (ids.length === 0) return;
              await act(async () => {
                for (const id of ids) {
                  if (action === 'approve') await capabilities.approve(id, 'registration');
                  else await capabilities.reject(id, 'bulk');
                }
              });
              setSelectedProposalIds((prev) => {
                const next = new Set(prev);
                for (const id of ids) next.delete(id);
                return next;
              });
            }}
          />
          {proposals.length === 0
            ? <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim, fontFamily: MONO, mt: 2 }}>No pending proposals. Observed patterns and user-prompt creations appear here for review.</Typography>
            : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.5 }}>
                {proposals.map((item) => (
                  <ProposalReviewCard
                    key={item.id}
                    item={item}
                    selected={selectedProposalIds.has(item.id)}
                    onSelect={(id, checked) => {
                      setSelectedProposalIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                    onApprove={(id, gate) => void act(() => capabilities.approve(id, gate))}
                    onReject={(id) => setDialog({ mode: 'reject', id, name: item.name, sideEffects: item.kind === 'tool' ? item.sideEffects : undefined })}
                    onTest={(id) => void openDetail(items.find((i) => i.id === id) ?? item)}
                    onOpen={(id) => void openDetail(items.find((i) => i.id === id) ?? item)}
                  />
                ))}
              </Box>
            )}
        </>
      );
    }
    if (view === 'list') {
      return (
        <CapabilityList
          items={items}
          selectedId={selected?.id}
          onOpen={(item) => void openDetail(item)}
          onExport={exportCsv}
          onApproveBulk={(selectedItems) => setBulkDialog({
            open: true,
            ids: selectedItems.map((i) => i.id),
            names: selectedItems.map((i) => i.name),
            sideEffects: selectedItems
              .filter((i) => i.kind === 'tool' && i.sideEffects.length > 0)
              .map((i) => ({ name: i.name, effects: (i as { sideEffects: string[] }).sideEffects })),
          })}
          onBulk={(ids, action) => void act(async () => {
            for (const id of ids) {
              if (action === 'disable') await capabilities.disable(id);
              if (action === 'enable') await capabilities.enable(id);
              if (action === 'archive') await capabilities.archive(id);
            }
          })}
        />
      );
    }
    if (view === 'detail' && selected) {
      return (
        <Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            {(selected.status === 'proposed' || selected.status === 'sandbox-passed' || selected.status === 'in-trial') && (
              <Button size="small" onClick={() => setDialog({ mode: 'approve', id: selected.id, name: selected.name, sideEffects: selected.kind === 'tool' ? selected.sideEffects : undefined })} sx={{ fontFamily: MONO, textTransform: 'none' }}>Approve</Button>
            )}
            {selected.kind === 'tool' && (selected.status === 'proposed' || selected.status === 'sandbox-failed') && (
              <Button size="small" onClick={() => void act(() => capabilities.sandbox(selected.id))} sx={{ fontFamily: MONO, textTransform: 'none' }}>Run sandbox</Button>
            )}
            {selected.status === 'registered' && (
              <Button size="small" onClick={() => void act(() => capabilities.disable(selected.id))} sx={{ fontFamily: MONO, textTransform: 'none' }}>Disable</Button>
            )}
            {selected.status === 'disabled' && (
              <Button size="small" onClick={() => void act(() => capabilities.enable(selected.id))} sx={{ fontFamily: MONO, textTransform: 'none' }}>Enable</Button>
            )}
            {selected.status !== 'archived' && (
              <Button size="small" color="error" onClick={() => setDialog({ mode: 'reject', id: selected.id, name: selected.name, sideEffects: selected.kind === 'tool' ? selected.sideEffects : undefined })} sx={{ fontFamily: MONO, textTransform: 'none' }}>Reject</Button>
            )}
          </Box>
          <CapabilityDetail
            selected={selected}
            gates={gates}
            audit={audit}
            usage={usage}
            testCases={testCases}
            onSavedCases={() => { if (selected) void capabilities.testCases(selected.id).then((r) => setTestCases(r.testCases)); }}
            onSaved={(cap) => { setSelected(cap); void openDetail(cap); }}
          />
        </Box>
      );
    }
    return null;
  })();

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelHeader
        title="Capabilities"
        subtitle="Synthetic Intelligence lab — observe, generate, approve"
        icon={<AutoAwesomeIcon sx={{ fontSize: 20, color: colors.accent.blue }} />}
        action={action}
      />

      <Box
        className="ax-scroll-x"
        sx={{
          flexShrink: 0,
          display: 'flex',
          gap: 0.5,
          px: 2,
          py: 0.75,
          borderBottom: `1px solid ${colors.border.default}`,
          bgcolor: colors.bg.secondary,
        }}
      >
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="small"
            onClick={() => setView(t.id)}
            startIcon={t.icon}
            sx={{
              minWidth: 88,
              fontFamily: MONO,
              textTransform: 'none',
              fontSize: '0.68rem',
              color: view === t.id ? colors.accent.cyan : colors.text.dim,
              bgcolor: view === t.id ? alphaColor(colors.accent.cyan, '10') : 'transparent',
              border: `1px solid ${view === t.id ? colors.accent.cyan : colors.border.strong}`,
              borderRadius: 1,
              px: 1,
              transition: 'all 0.18s ease',
              '&:hover': {
                color: colors.accent.cyan,
                bgcolor: alphaColor(colors.accent.cyan, '08'),
                borderColor: colors.accent.cyan,
              },
            }}
          >
            {t.label}
            {t.id === 'proposals' && pending > 0 ? ` (${pending})` : ''}
          </Button>
        ))}
      </Box>

      <Box className="ax-scroll" sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {error && categorizeError(error) === 'store' && (
          <Alert
            severity="error"
            sx={{
              mb: 1,
              fontFamily: MONO,
              fontSize: '0.7rem',
              border: `1px solid ${colors.accent.red}`,
              bgcolor: alphaColor(colors.accent.red, '08'),
              '& .MuiAlert-icon': { color: colors.accent.red },
            }}
            action={<Button size="small" onClick={() => void load()} sx={{ fontFamily: MONO, textTransform: 'none', color: colors.accent.red }}>Retry</Button>}
          >
            <Typography sx={{ fontWeight: 600, fontFamily: MONO, fontSize: '0.72rem' }}>Capability store is unavailable</Typography>
            We can’t reach the capability store right now. Data may be stale. Retry or contact your admin if this persists.
          </Alert>
        )}
        {error && categorizeError(error) === 'sandbox' && (
          <Alert
            severity="error"
            sx={{
              mb: 1,
              fontFamily: MONO,
              fontSize: '0.7rem',
              border: `1px solid ${colors.accent.orange}`,
              bgcolor: alphaColor(colors.accent.orange, '08'),
              '& .MuiAlert-icon': { color: colors.accent.orange },
            }}
            action={<Button size="small" onClick={() => void load()} sx={{ fontFamily: MONO, textTransform: 'none', color: colors.accent.orange }}>Retry</Button>}
          >
            <Typography sx={{ fontWeight: 600, fontFamily: MONO, fontSize: '0.72rem' }}>Process sandbox failed</Typography>
            The sandbox run timed out or failed. Retry the action, or edit the tool before running it again.
          </Alert>
        )}
        {error && !categorizeError(error) && (
          <Typography sx={{ color: colors.accent.red, fontSize: '0.75rem', mb: 1, fontFamily: MONO }}>
            {error} <Button size="small" onClick={() => void load()} sx={{ fontFamily: MONO, textTransform: 'none' }}>Retry</Button>
          </Typography>
        )}

        {loading && view !== 'detail' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={22} sx={{ color: colors.text.dim }} />
          </Box>
        )}

        {!loading && view !== 'detail' && view !== 'create' && (
          <Grow in timeout={400} key={`stats-${view}`}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              <StatCard label="Observed" value={observations.length} color={colors.accent.blue} />
              <StatCard label="Proposed" value={stats.byStatus['proposed'] ?? 0} color={colors.accent.orange} />
              <StatCard label="In trial" value={stats.byStatus['in-trial'] ?? 0} color={colors.accent.cyan} />
              <StatCard label="Registered" value={stats.byStatus['registered'] ?? 0} color={colors.accent.green} />
              <StatCard label="Total" value={stats.total} />
            </Box>
          </Grow>
        )}

        <Fade in timeout={250} key={view}>
          <Box>
            {content}
          </Box>
        </Fade>
      </Box>

      <ApprovalWorkflow
        open={!!dialog}
        name={dialog?.name ?? ''}
        mode={dialog?.mode ?? 'approve'}
        sideEffects={dialog?.sideEffects}
        onClose={() => setDialog(null)}
        onConfirm={(payload) => {
          if (!dialog) return;
          if (dialog.mode === 'approve') void act(() => capabilities.approve(dialog.id, payload.gate));
          else void act(() => capabilities.reject(dialog.id, payload.reason, payload.feedback));
          setDialog(null);
        }}
      />
      <BulkApprovalDialog
        open={!!bulkDialog}
        names={bulkDialog?.names ?? []}
        sideEffects={bulkDialog?.sideEffects}
        onClose={() => setBulkDialog(null)}
        onConfirm={(gate) => {
          if (!bulkDialog) return;
          const { ids } = bulkDialog;
          setBulkDialog(null);
          void act(async () => {
            for (const id of ids) {
              await capabilities.approve(id, gate);
            }
          });
        }}
      />
      <TourGuide open={tourOpen} onClose={() => setTourOpen(false)} />
      <ConsentDialog
        open={consentDialog.open}
        pattern={consentDialog.pattern}
        onChoose={async (value: ConsentChoice) => {
          const { patternId } = consentDialog;
          setConsentDialog({ open: false });
          if (!patternId) {
            void capabilities.consent(value).catch(() => undefined);
            return;
          }
          if (value === 'once') {
            void capabilities.generateFromObservation(patternId).catch(() => undefined);
          } else if (value === 'always') {
            await capabilities.consent('always').catch(() => undefined);
            void capabilities.generateFromObservation(patternId).catch(() => undefined);
          } else if (value === 'deny') {
            void capabilities.ignoreObservation(patternId).catch(() => undefined);
          } else if (value === 'deny-permanently') {
            await capabilities.consent('deny-permanently').catch(() => undefined);
            void capabilities.ignoreObservation(patternId).catch(() => undefined);
          }
        }}
      />
    </Box>
  );
}
