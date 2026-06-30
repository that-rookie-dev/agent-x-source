import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox';
import { tools, type ToolInfo, type ToolCategory } from '../api';
import { colors } from '../theme';
import { PanelHeader } from './PanelHeader';

const RISK_COLORS: Record<string, string> = {
  low: colors.accent.green,
  medium: colors.accent.orange,
  high: colors.accent.red,
  critical: colors.accent.red,
};

export function ToolsPanel() {
  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    tools.list().then((list) => {
      const catMap = new Map<string, ToolInfo[]>();
      list.forEach((t) => {
        const cat = t.category || 'uncategorized';
        catMap.set(cat, [...(catMap.get(cat) ?? []), t]);
      });
      setCategories(
        Array.from(catMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, items]) => ({ category, count: items.length, tools: items }))
      );
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  // Expand/collapse
  const toggleExpand = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Toggle single tool
  const handleToggleTool = async (id: string, currentEnabled: boolean) => {
    try {
      await tools.toggle(id, !currentEnabled);
      setCategories((cats) => cats.map((c) => ({
        ...c,
        tools: c.tools.map((t) => t.id === id ? { ...t, enabled: !currentEnabled } : t),
      })));
    } catch { /* ignore */ }
  };

  // Toggle entire category
  const handleToggleCategory = async (cat: ToolCategory) => {
    const allEnabled = cat.tools.every((t) => t.enabled);
    const newEnabled = !allEnabled;
    try {
      await tools.bulkToggle({ category: cat.category, enabled: newEnabled });
      setCategories((cats) => cats.map((c) =>
        c.category === cat.category
          ? { ...c, tools: c.tools.map((t) => ({ ...t, enabled: newEnabled })) }
          : c
      ));
    } catch { /* ignore */ }
  };

  // Toggle all globally
  const handleToggleAll = async () => {
    const allEnabled = categories.every((c) => c.tools.every((t) => t.enabled));
    const newEnabled = !allEnabled;
    try {
      await tools.bulkToggle({ enabled: newEnabled });
      setCategories((cats) => cats.map((c) => ({
        ...c,
        tools: c.tools.map((t) => ({ ...t, enabled: newEnabled })),
      })));
    } catch { /* ignore */ }
  };

  // Stats
  const totalTools = categories.reduce((s, c) => s + c.tools.length, 0);
  const totalEnabled = categories.reduce((s, c) => s + c.tools.filter((t) => t.enabled).length, 0);
  const globalState: 'all' | 'none' | 'partial' =
    totalEnabled === totalTools ? 'all' : totalEnabled === 0 ? 'none' : 'partial';

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PanelHeader
        title="Tools Registry"
        subtitle={`${totalEnabled}/${totalTools} enabled`}
        action={
          <Button
            size="small"
            onClick={handleToggleAll}
            sx={{ fontSize: '0.65rem', textTransform: 'none', color: globalState === 'all' ? colors.accent.red : colors.accent.green }}
          >
            {globalState === 'all' ? 'Disable All' : 'Enable All'}
          </Button>
        }
      />

      {/* Tree */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 1 }}>
        {categories.map((cat) => {
          const isExpanded = expanded.has(cat.category);
          const enabledCount = cat.tools.filter((t) => t.enabled).length;
          const catState: 'all' | 'none' | 'partial' =
            enabledCount === cat.tools.length ? 'all' : enabledCount === 0 ? 'none' : 'partial';

          return (
            <Box key={cat.category}>
              {/* Category node */}
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', px: 1.5, py: 0.4,
                  cursor: 'pointer', '&:hover': { bgcolor: colors.bg.tertiary },
                  userSelect: 'none',
                }}
                onClick={() => toggleExpand(cat.category)}
              >
                {/* Tree connector */}
                <Box sx={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 0.5, position: 'relative' }}>
                  {isExpanded
                    ? <KeyboardArrowDownIcon sx={{ fontSize: 16, color: colors.text.dim }} />
                    : <KeyboardArrowRightIcon sx={{ fontSize: 16, color: colors.text.dim }} />
                  }
                </Box>

                {/* Category checkbox */}
                <Checkbox
                  size="small"
                  checked={catState === 'all'}
                  indeterminate={catState === 'partial'}
                  onClick={(e) => { e.stopPropagation(); handleToggleCategory(cat); }}
                  icon={<CheckBoxOutlineBlankIcon sx={{ fontSize: 16 }} />}
                  checkedIcon={<CheckBoxIcon sx={{ fontSize: 16 }} />}
                  indeterminateIcon={<IndeterminateCheckBoxIcon sx={{ fontSize: 16, color: colors.accent.orange }} />}
                  sx={{ p: 0.25, mr: 0.75, color: colors.text.dim, '&.Mui-checked': { color: colors.accent.green } }}
                />

                {/* Category label */}
                <Typography sx={{
                  fontSize: '0.75rem', fontWeight: 600, flex: 1,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: catState === 'all' ? colors.text.primary : catState === 'partial' ? colors.text.secondary : colors.text.dim,
                }}>
                  {cat.category.replace(/_/g, ' ')}
                </Typography>

                {/* Count */}
                <Chip size="small" label={`${enabledCount}/${cat.tools.length}`} sx={{
                  fontSize: '0.5rem', height: 16, minWidth: 32,
                  color: catState === 'all' ? colors.accent.green : catState === 'none' ? colors.text.dim : colors.accent.orange,
                  bgcolor: 'transparent',
                }} />
              </Box>

              {/* Tool leaves */}
              <Collapse in={isExpanded}>
                <Box sx={{ ml: '33px' }}>
                {cat.tools.map((tool) => {
                  return (
                    <Box
                      key={tool.id}
                      sx={{
                        display: 'flex', alignItems: 'center', pl: 1.5, pr: 1.5, py: 0.3,
                        '&:hover': { bgcolor: colors.bg.tertiary },
                      }}
                    >

                      {/* Tool checkbox */}
                      <Checkbox
                        size="small"
                        checked={tool.enabled}
                        onChange={() => handleToggleTool(tool.id, tool.enabled)}
                        icon={<CheckBoxOutlineBlankIcon sx={{ fontSize: 14 }} />}
                        checkedIcon={<CheckBoxIcon sx={{ fontSize: 14 }} />}
                        sx={{ p: 0.25, mr: 0.75, color: colors.text.dim, '&.Mui-checked': { color: colors.accent.green } }}
                      />

                      {/* Tool info */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{
                          fontSize: '0.7rem', fontWeight: 500,
                          color: tool.enabled ? colors.text.primary : colors.text.dim,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {tool.name}
                        </Typography>
                      </Box>

                      {/* Risk badge */}
                      {tool.riskLevel && (
                        <Tooltip title={`Risk: ${tool.riskLevel}`} placement="left">
                          <Box sx={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0, ml: 1,
                            bgcolor: RISK_COLORS[tool.riskLevel] ?? colors.text.dim,
                            opacity: tool.enabled ? 1 : 0.3,
                          }} />
                        </Tooltip>
                      )}
                    </Box>
                  );
                })}
                </Box>
              </Collapse>
            </Box>
          );
        })}

        {categories.length === 0 && (
          <Typography sx={{ color: colors.text.dim, textAlign: 'center', mt: 4, fontSize: '0.8rem' }}>
            No tools registered
          </Typography>
        )}
      </Box>

      {/* Legend */}
      <Box sx={{ px: 2, py: 1, borderTop: `1px solid ${colors.border.default}`, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.green }} />
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Low</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.orange }} />
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>Medium</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.accent.red }} />
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>High/Critical</Typography>
        </Box>
      </Box>
    </Box>
  );
}
