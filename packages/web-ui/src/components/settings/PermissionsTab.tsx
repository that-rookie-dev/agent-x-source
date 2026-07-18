import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import InputBase from '@mui/material/InputBase';
import RefreshIcon from '@mui/icons-material/Refresh';
import SecurityIcon from '@mui/icons-material/Security';
import { settingsPermissionTools, settingsPermissions, type PermissionToolEntry } from '../../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsBtnDangerSx,
} from '../../styles/settings-theme';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { SettingsCard } from './SettingsCard';

type ToolDecision = 'allow' | 'deny' | 'ask';

export interface PermissionsTabProps {
  value: Record<string, ToolDecision> | undefined;
  onChange: (next: Record<string, ToolDecision>) => void;
}

const DECISION_LABELS: Record<ToolDecision, string> = {
  allow: 'Allow',
  deny: 'Deny',
  ask: 'Ask',
};

const DECISION_COLORS: Record<ToolDecision, string> = {
  allow: settingsTheme.accent.signal,
  deny: settingsTheme.accent.alert,
  ask: settingsTheme.accent.amber,
};

const RISK_COLORS: Record<string, string> = {
  low: settingsTheme.accent.signal,
  medium: settingsTheme.accent.amber,
  high: settingsTheme.accent.alert,
  critical: settingsTheme.accent.alert,
};

const RISK_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

const CATEGORY_LABELS: Record<string, string> = {
  filesystem: 'Filesystem',
  code_intelligence: 'Code Intelligence',
  shell_process: 'Shell / Process',
  git_vcs: 'Git / VCS',
  package_managers: 'Package Managers',
  web_network: 'Web / Network',
  database: 'Database',
  documents: 'Documents',
  testing: 'Testing',
  containers_infra: 'Containers / Infra',
  communication: 'Communication',
  ai_meta: 'AI / Meta',
  browser_automation: 'Browser Automation',
  system_os: 'System / OS',
  security_crypto: 'Security / Crypto',
  data_processing: 'Data Processing',
  project_management: 'Project Management',
  media_image: 'Media / Image',
  workspace_ide: 'Workspace / IDE',
  scheduler: 'Scheduler',
  agent_orchestration: 'Agent Orchestration',
  agent_meta: 'Agent Meta',
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Compute the default decision for a tool based on its risk level. */
function defaultDecisionFor(riskLevel: string): ToolDecision {
  return riskLevel === 'low' ? 'allow' : 'ask';
}

export function PermissionsTab({ value, onChange }: PermissionsTabProps) {
  const [tools, setTools] = useState<PermissionToolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'overridden' | 'allow' | 'ask' | 'deny'>('all');
  const [resetting, setResetting] = useState(false);
  const [activeTab, setActiveTab] = useState<'native' | 'mcp'>('native');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Fetch tools + permissions only once on mount.
  useEffect(() => {
    let cancelled = false;
    settingsPermissionTools.list()
      .then((result) => {
        if (cancelled) return;
        setTools(result.tools);
        onChangeRef.current(result.permissions ?? {});
      })
      .catch(() => { if (!cancelled) onChangeRef.current({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const permissions = value ?? {};

  /** Resolve the effective decision for a tool: override > backend default > risk heuristic. */
  const effectiveDecision = (tool: PermissionToolEntry): ToolDecision =>
    permissions[tool.id] ?? tool.defaultDecision ?? defaultDecisionFor(tool.riskLevel);

  const setDecision = (toolId: string, decision: ToolDecision) => {
    onChange({ ...permissions, [toolId]: decision });
  };

  const resetTool = (toolId: string) => {
    const { [toolId]: _, ...rest } = permissions;
    void _;
    onChange(rest);
  };

  const nativeBase = useMemo(
    () => tools.filter((t) => t.source === 'native' && t.category !== 'integrations'),
    [tools],
  );
  const mcpBase = useMemo(() => tools.filter((t) => t.source === 'mcp'), [tools]);
  const activeBase = activeTab === 'native' ? nativeBase : mcpBase;

  const resetToDefault = async () => {
    setResetting(true);
    try {
      const cleared = { ...permissions };
      for (const t of activeBase) {
        delete cleared[t.id];
      }
      await settingsPermissions.update(cleared);
      onChange(cleared);
    } catch { /* ignore — user can retry */ } finally {
      setResetting(false);
    }
  };

  const filteredTools = useMemo(() => {
    let result = activeBase;
    if (filter === 'overridden') {
      result = result.filter((t) => t.id in permissions);
    } else if (filter !== 'all') {
      result = result.filter((t) => effectiveDecision(t) === filter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((t) =>
        t.id.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (activeTab === 'native' ? categoryLabel(t.category) : (t.providerName ?? 'MCP')).toLowerCase().includes(q),
      );
    }
    return result;
  }, [activeBase, permissions, filter, search, activeTab]);

  const grouped = useMemo(() => {
    const groups: Record<string, PermissionToolEntry[]> = {};
    for (const t of filteredTools) {
      const key = activeTab === 'native' ? t.category : (t.providerName ?? 'Connected MCP');
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredTools, activeTab]);

  const overriddenCount = useMemo(
    () => activeBase.filter((t) => t.id in permissions).length,
    [activeBase, permissions],
  );

  const filterChips: Array<{ id: typeof filter; label: string; count: number }> = useMemo(() => [
    { id: 'all', label: 'All', count: activeBase.length },
    { id: 'overridden', label: 'Modified', count: overriddenCount },
    { id: 'allow', label: 'Allow', count: activeBase.filter((t) => effectiveDecision(t) === 'allow').length },
    { id: 'ask', label: 'Ask', count: activeBase.filter((t) => effectiveDecision(t) === 'ask').length },
    { id: 'deny', label: 'Deny', count: activeBase.filter((t) => effectiveDecision(t) === 'deny').length },
  ], [activeBase, overriddenCount, permissions]);

  return (
    <Box>
      <SettingsSectionHeader
        icon={<SecurityIcon sx={{ fontSize: 16 }} />}
        title="Default Tool Permissions"
        subtitle="Choose how Agent-X handles each tool before a session is started"
        action={
          <Button
            size="small"
            variant="outlined"
            onClick={resetToDefault}
            disabled={overriddenCount === 0 || resetting}
            sx={settingsBtnDangerSx}
            startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
          >
            {resetting ? 'Resetting…' : 'Reset to Default'}
          </Button>
        }
      />

      <SettingsCard title={activeTab === 'native' ? 'Native tools' : 'Connected MCP tools'} active={false}>
        {/* Search + filter bar */}
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <InputBase
            placeholder="Search tools…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{
              flex: 1,
              minWidth: 120,
              ...settingsMonoSx,
              fontSize: '0.65rem',
              bgcolor: settingsTheme.bg.inset,
              border: `1px solid ${settingsTheme.border.default}`,
              borderRadius: 1,
              px: 1,
              py: 0.4,
              '&:focus-within': { borderColor: settingsTheme.accent.hud },
            }}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5, flexWrap: 'wrap' }}>
          {filterChips.map((chip) => (
            <Box
              key={chip.id}
              onClick={() => setFilter(chip.id)}
              sx={{
                cursor: 'pointer',
                px: 1,
                py: 0.25,
                borderRadius: 1,
                fontSize: '0.6rem',
                fontFamily: "'JetBrains Mono', monospace",
                border: `1px solid ${filter === chip.id ? settingsTheme.accent.hud : settingsTheme.border.default}`,
                color: filter === chip.id ? settingsTheme.accent.hud : settingsTheme.text.dim,
                bgcolor: filter === chip.id ? settingsTheme.bg.hud : 'transparent',
                '&:hover': { borderColor: settingsTheme.accent.hud, color: settingsTheme.accent.hud },
              }}
            >
              {chip.label} ({chip.count})
            </Box>
          ))}
        </Box>

        {/* Native / MCP tabs */}
        <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5, borderBottom: `1px solid ${settingsTheme.border.subtle}` }}>
          {(['native', 'mcp'] as const).map((tab) => (
            <Button
              key={tab}
              size="small"
              onClick={() => { setActiveTab(tab); setFilter('all'); }}
              sx={{
                textTransform: 'none',
                fontSize: '0.72rem',
                color: activeTab === tab ? settingsTheme.text.primary : settingsTheme.text.dim,
                borderRadius: 0,
                pb: 0.5,
                borderBottom: activeTab === tab ? `2px solid ${settingsTheme.accent.hud}` : '2px solid transparent',
              }}
            >
              {tab === 'native' ? 'Native' : 'MCP'}
            </Button>
          ))}
        </Box>

        {loading && (
          <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.dim, ...settingsMonoSx, mb: 1 }}>
            Loading tools…
          </Typography>
        )}

        {!loading && filteredTools.length === 0 && (
          <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
            No tools match the current filter.
          </Typography>
        )}

        {/* Tool table grouped by category (Native) or provider (MCP) */}
        {!loading && grouped.map(([group, groupTools]) => (
          <Box key={group} sx={{ mb: 2 }}>
            <Typography sx={{
              ...settingsMonoSx,
              fontSize: '0.6rem',
              color: settingsTheme.accent.hud,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              mb: 0.5,
              borderBottom: `1px solid ${settingsTheme.border.subtle}`,
              pb: 0.25,
            }}>
              {activeTab === 'native' ? categoryLabel(group) : `MCP · ${group}`} ({groupTools.length})
            </Typography>

            {/* Table header */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 60px 50px 50px 50px 28px',
              gap: 0.5,
              alignItems: 'center',
              px: 1,
              py: 0.3,
              ...settingsMonoSx,
              fontSize: '0.55rem',
              color: settingsTheme.text.dim,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              <Box>Tool</Box>
              <Box sx={{ textAlign: 'center' }}>Risk</Box>
              <Box sx={{ textAlign: 'center' }}>Allow</Box>
              <Box sx={{ textAlign: 'center' }}>Ask</Box>
              <Box sx={{ textAlign: 'center' }}>Deny</Box>
              <Box />
            </Box>

            {groupTools.map((tool) => {
              const decision = effectiveDecision(tool);
              const isOverridden = tool.id in permissions;
              return (
                <Box
                  key={tool.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 60px 50px 50px 50px 28px',
                    gap: 0.5,
                    alignItems: 'center',
                    px: 1,
                    py: 0.5,
                    borderBottom: `1px solid ${settingsTheme.border.subtle}`,
                    '&:hover': { bgcolor: settingsTheme.bg.inset },
                    ...(isOverridden ? { borderLeft: `2px solid ${DECISION_COLORS[decision]}` } : {}),
                  }}
                >
                  {/* Tool name + description */}
                  <Box sx={{ minWidth: 0 }}>
                    <Tooltip title={tool.description} placement="top" arrow>
                      <Typography sx={{
                        fontSize: '0.65rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: isOverridden ? settingsTheme.text.primary : settingsTheme.text.dim,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {tool.name}
                        <Box component="span" sx={{ color: settingsTheme.text.dim, ml: 0.5, fontSize: '0.6rem' }}>
                          ({tool.id})
                        </Box>
                      </Typography>
                    </Tooltip>
                  </Box>

                  {/* Risk level badge */}
                  <Box sx={{ textAlign: 'center' }}>
                    <Box sx={{
                      display: 'inline-block',
                      px: 0.5,
                      py: 0.1,
                      borderRadius: 0.5,
                      fontSize: '0.55rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: RISK_COLORS[tool.riskLevel] ?? settingsTheme.text.dim,
                      bgcolor: `${RISK_COLORS[tool.riskLevel] ?? settingsTheme.text.dim}15`,
                    }}>
                      {RISK_LABELS[tool.riskLevel] ?? tool.riskLevel}
                    </Box>
                  </Box>

                  {/* Radio group: allow / ask / deny */}
                  <RadioGroup
                    row
                    value={decision}
                    onChange={(e) => setDecision(tool.id, e.target.value as ToolDecision)}
                    sx={{ display: 'contents' }}
                  >
                    {(['allow', 'ask', 'deny'] as ToolDecision[]).map((d) => (
                      <Box key={d} sx={{ textAlign: 'center', display: 'flex', justifyContent: 'center' }}>
                        <Tooltip title={DECISION_LABELS[d]} placement="top" arrow>
                          <Radio
                            size="small"
                            value={d}
                            checked={decision === d}
                            onChange={() => setDecision(tool.id, d)}
                            sx={{
                              padding: '2px',
                              color: DECISION_COLORS[d],
                              '&.Mui-checked': { color: DECISION_COLORS[d] },
                              '& .MuiSvgIcon-root': { fontSize: 14 },
                            }}
                          />
                        </Tooltip>
                      </Box>
                    ))}
                  </RadioGroup>

                  {/* Reset single tool */}
                  <Box sx={{ textAlign: 'center' }}>
                    {isOverridden && (
                      <Tooltip title="Reset to default" placement="top" arrow>
                        <IconButton
                          size="small"
                          onClick={() => resetTool(tool.id)}
                          sx={{ color: settingsTheme.text.dim, '&:hover': { color: settingsTheme.accent.hud }, padding: '2px' }}
                        >
                          <RefreshIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        ))}

        {/* Summary + legend */}
        <Box sx={{ mt: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {(['allow', 'ask', 'deny'] as ToolDecision[]).map((d) => (
            <Box key={d} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: DECISION_COLORS[d] }} />
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.55rem', color: settingsTheme.text.dim }}>
                {DECISION_LABELS[d]}
              </Typography>
            </Box>
          ))}
        </Box>

        <Typography sx={{ ...settingsHelperSx, mt: 1 }}>
          <strong>Allow</strong> runs the tool without prompts. <strong>Ask</strong> prompts each time. <strong>Deny</strong> blocks the tool.
          {overriddenCount > 0 && ` ${overriddenCount} tool${overriddenCount === 1 ? '' : 's'} modified from default.`}
          {' '}Session-level overrides are available in the chat toolbar.
        </Typography>
      </SettingsCard>
    </Box>
  );
}

export default PermissionsTab;
