import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import Chip from '@mui/material/Chip';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { tools, type ToolInfo, type ToolCategory } from '../api';
import { colors } from '../theme';

export function ToolsPanel() {
  const [categories, setCategories] = useState<ToolCategory[]>([]);

  useEffect(() => {
    tools.categories().then(setCategories).catch(() => {
      // Fallback to flat list
      tools.list().then((list) => {
        const catMap = new Map<string, ToolInfo[]>();
        list.forEach((t) => { const cat = t.category || 'uncategorized'; catMap.set(cat, [...(catMap.get(cat) ?? []), t]); });
        setCategories(Array.from(catMap.entries()).map(([category, items]) => ({ category, count: items.length, tools: items })));
      }).catch(() => {});
    });
  }, []);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await tools.toggle(id, !enabled);
      setCategories((cats) => cats.map((c) => ({
        ...c,
        tools: c.tools.map((t) => t.id === id ? { ...t, enabled: !enabled } : t),
      })));
    } catch { /* ignore */ }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Tools Registry</Typography>

      {categories.map((cat) => (
        <Accordion key={cat.category} defaultExpanded sx={{ bgcolor: 'transparent', border: `1px solid ${colors.border.default}`, mb: 1, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: colors.text.dim }} />}>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>{cat.category}</Typography>
            <Chip size="small" label={cat.count} sx={{ ml: 1, fontSize: '0.6rem', height: 18 }} />
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            {cat.tools.map((tool) => (
              <Box key={tool.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75, borderBottom: `1px solid ${colors.border.default}`, '&:last-child': { borderBottom: 'none' } }}>
                <Box>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{tool.name}</Typography>
                  <Typography variant="caption" sx={{ color: colors.text.dim }}>{tool.description}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {tool.riskLevel && <Chip size="small" label={tool.riskLevel} sx={{ fontSize: '0.55rem', height: 16, bgcolor: tool.riskLevel === 'high' ? colors.accent.red + '20' : 'transparent' }} />}
                  <Switch size="small" checked={tool.enabled} onChange={() => handleToggle(tool.id, tool.enabled)} />
                </Box>
              </Box>
            ))}
          </AccordionDetails>
        </Accordion>
      ))}

      {categories.length === 0 && (
        <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 4 }}>No tools registered</Typography>
      )}
    </Box>
  );
}
