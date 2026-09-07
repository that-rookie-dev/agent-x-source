import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { colors, MONO } from '../../theme';
import { StatusChip, STATUS_HELP } from './status';
import { AuditTimeline } from './AuditTimeline';
import { CapabilityPlayground } from './CapabilityPlayground';
import { capabilities, type CapabilityAuditRecord, type CapabilityRecord, type CapabilityTestCaseRecord, type CapabilityUsageReportRecord, type GraduationGateRecord } from '../../api';

type Tab = 'overview' | 'source' | 'audit' | 'sandbox' | 'usage' | 'trial';

export function CapabilityDetail({
  selected,
  gates,
  audit,
  usage,
  testCases,
  onSavedCases,
  onSaved,
}: {
  selected: CapabilityRecord;
  gates: GraduationGateRecord[];
  audit: CapabilityAuditRecord[];
  usage: CapabilityUsageReportRecord | null;
  testCases: CapabilityTestCaseRecord[];
  onSavedCases: () => void;
  onSaved?: (cap: CapabilityRecord) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [name, setName] = useState(selected.name);
  const original = selected.kind === 'tool'
    ? (selected.originalSourceCode ?? selected.sourceCode)
    : selected.kind === 'skill' ? selected.promptTemplate
      : selected.kind === 'knowledge' ? selected.content : '';
  const [source, setSource] = useState(
    selected.kind === 'tool' ? selected.sourceCode
      : selected.kind === 'skill' ? selected.promptTemplate
        : selected.kind === 'knowledge' ? selected.content : ''
  );
  const [saving, setSaving] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [eventFilter, setEventFilter] = useState('');
  const editable = selected.status === 'proposed' || selected.status === 'in-trial' || selected.status === 'sandbox-passed' || selected.status === 'sandbox-failed';

  useEffect(() => {
    setName(selected.name);
    setSource(
      selected.kind === 'tool' ? selected.sourceCode
        : selected.kind === 'skill' ? selected.promptTemplate
          : selected.kind === 'knowledge' ? selected.content : ''
    );
    setTab('overview');
    setEventFilter('');
  }, [selected.id]);

  const save = async () => {
    setSaving(true);
    try {
      const body = selected.kind === 'tool' ? { sourceCode: source } : selected.kind === 'skill' ? { promptTemplate: source } : { content: source };
      const { capability } = await capabilities.update(selected.id, body);
      onSaved?.(capability);
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    setSavingName(true);
    try {
      const { capability } = await capabilities.updateCapabilityContent(selected.id, { name: name.trim() });
      setName(capability.name);
      onSaved?.(capability);
    } finally {
      setSavingName(false);
    }
  };

  const eventTypes = useMemo(() => Array.from(new Set(audit.map((ev) => ev.event))).sort(), [audit]);
  const filteredAudit = useMemo(() => {
    if (!eventFilter) return audit;
    return audit.filter((ev) => ev.event === eventFilter);
  }, [audit, eventFilter]);

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
        <TextField
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!editable}
          inputProps={{ 'aria-label': 'Capability name' }}
          sx={{ flex: 1, minWidth: 200, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.85rem' } }}
        />
        {editable && (
          <Button size="small" disabled={savingName || name.trim() === selected.name} onClick={() => void saveName()} sx={{ fontFamily: MONO, textTransform: 'none' }}>Save</Button>
        )}
      </Box>
      <Typography sx={{ fontSize: '0.72rem', color: colors.text.secondary, mt: 0.5, mb: 1 }}>{selected.description}</Typography>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
        <Chip size="small" label={selected.kind} sx={{ fontFamily: MONO, fontSize: '0.62rem' }} />
        <StatusChip status={selected.status} />
        <Chip size="small" label={selected.origin} sx={{ fontFamily: MONO, fontSize: '0.62rem' }} />
      </Box>
      <Typography sx={{ fontSize: '0.62rem', color: colors.text.dim, mb: 1.5 }}>{STATUS_HELP[selected.status] ?? ''}</Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
        {(['overview', 'source', 'audit', 'sandbox', 'usage', 'trial'] as Tab[]).map((t) => (
          <Button key={t} size="small" onClick={() => setTab(t)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem', color: tab === t ? colors.accent.blue : colors.text.dim }}>
            {t}
          </Button>
        ))}
      </Box>
      {tab === 'overview' && (
        <Box>
          <Typography sx={{ fontSize: '0.62rem', color: colors.text.dim, fontFamily: MONO, mb: 0.5 }}>GATES</Typography>
          {gates.map((g) => (
            <Typography key={g.gate} sx={{ fontSize: '0.7rem', fontFamily: MONO, color: colors.text.secondary }}>
              {g.gate}: {g.status}{g.notes ? ` — ${g.notes}` : ''}
            </Typography>
          ))}
        </Box>
      )}
      {tab === 'source' && (
        <Box>
          <TextField
            fullWidth
            multiline
            minRows={8}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={!editable}
            inputProps={{ 'aria-label': 'Capability source' }}
            sx={{ '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.68rem' } }}
          />
          <Typography sx={{ fontSize: '0.58rem', fontFamily: MONO, color: colors.text.dim, mt: 0.5 }}>
            {source.split('\n').length} lines · {source.length} characters
            {editable ? '' : ' · read-only'}
          </Typography>
          {editable && (
            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
              <Button size="small" disabled={saving} onClick={() => void save()} sx={{ fontFamily: MONO, textTransform: 'none' }}>Save changes</Button>
              <Button size="small" onClick={() => setSource(original)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Reset to generated</Button>
            </Box>
          )}
        </Box>
      )}
      {tab === 'audit' && (
        <Box>
          <FormControl fullWidth size="small" sx={{ mb: 1 }}>
            <InputLabel id="audit-event-filter-label" sx={{ fontFamily: MONO, fontSize: '0.75rem' }}>Event</InputLabel>
            <Select
              labelId="audit-event-filter-label"
              value={eventFilter}
              label="Event"
              onChange={(e) => setEventFilter(e.target.value)}
              sx={{ '& .MuiSelect-select': { fontFamily: MONO, fontSize: '0.75rem' } }}
            >
              <MenuItem value=""><em>all events</em></MenuItem>
              {eventTypes.map((ev) => (
                <MenuItem key={ev} value={ev} sx={{ fontFamily: MONO, fontSize: '0.75rem' }}>{ev}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <AuditTimeline events={filteredAudit} capabilityId={selected.id} />
        </Box>
      )}
      {tab === 'sandbox' && <CapabilityPlayground item={selected} testCases={testCases} onSaved={onSavedCases} />}
      {tab === 'usage' && (
        <Box>
          <Typography sx={{ fontSize: '0.7rem', fontFamily: MONO, color: colors.text.secondary }}>
            uses {usage?.useCount ?? selected.useCount} · success {usage ? Math.round(usage.successRate * 100) : '—'}% · sessions {usage?.sessionCount ?? '—'}
            {usage?.userSatisfaction != null ? ` · satisfaction ${Math.round(usage.userSatisfaction * 100)}%` : ''}
            {usage?.crewCount != null ? ` · crews ${usage.crewCount}` : ''}
          </Typography>
          {usage?.perDay?.length ? (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end', height: 64, mt: 1 }} aria-label="Usage chart">
              {usage.perDay.slice(-14).map((d) => (
                <Box
                  key={d.day}
                  title={`${d.day}: ${d.count}`}
                  sx={{
                    width: 10,
                    height: `${Math.max(8, Math.min(100, d.count * 12))}%`,
                    bgcolor: colors.accent.blue,
                    borderRadius: 0.25,
                  }}
                />
              ))}
            </Box>
          ) : null}
        </Box>
      )}
      {tab === 'trial' && (
        <Typography sx={{ fontSize: '0.7rem', fontFamily: MONO, color: colors.text.secondary }}>
          {selected.status === 'in-trial' ? `Trial uses: ${selected.trialCount}` : 'Not in trial.'}
        </Typography>
      )}
    </Box>
  );
}
