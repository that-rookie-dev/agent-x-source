import { Router } from 'express';
import { getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';

export function createToolsRouter(): Router {
  const r = Router();

  r.get('/api/tools', (_req, res) => {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const disabled = cfg.ui?.disabledTools || [];
    let tools = eng.toolkit.registry.list();
    const enabledParam = (_req.query['enabled'] as string);
    if (enabledParam === 'true') {
      tools = tools.filter((t) => !disabled.includes(t.id));
    } else if (enabledParam === 'false') {
      tools = tools.filter((t) => disabled.includes(t.id));
    }
    // Always include enabled status
    res.json(tools.map((t) => ({ ...t, enabled: !disabled.includes(t.id) })));
  });

  r.post('/api/tools/bulk-toggle', (req, res) => {
    try {
      const eng = getEngine();
      const { ids, enabled } = req.body as { ids?: string[]; enabled: boolean; category?: string };
      const cfg = eng.configManager.load();
      const disabledSet = new Set(cfg.ui?.disabledTools || []);

      let targetIds = ids;
      if (!targetIds) {
        // If no ids but category provided, toggle all in category
        const category = req.body.category as string | undefined;
        const allTools = eng.toolkit.registry.list();
        targetIds = category
          ? allTools.filter((t) => t.category === category).map((t) => t.id)
          : allTools.map((t) => t.id);
      }

      for (const id of targetIds) {
        if (enabled) disabledSet.delete(id);
        else disabledSet.add(id);
      }

      cfg.ui = cfg.ui || {};
      cfg.ui.disabledTools = [...disabledSet];
      eng.configManager.save(cfg);
      res.json({ ok: true, toggled: targetIds.length, enabled });
    } catch (e) {
      getLogger().error('POST_API_TOOLS_BULK_TOGGLE', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'bulk-toggle-failed' });
    }
  });

  r.get('/api/tools/categories', (_req, res) => {
    const eng = getEngine();
    const tools = eng.toolkit.registry.list();
    const catMap: Record<string, { category: string; count: number; riskLevels: string[] }> = {};
    for (const t of tools) {
      if (!catMap[t.category]) catMap[t.category] = { category: t.category, count: 0, riskLevels: [] };
      const entry = catMap[t.category]!;
      entry.count++;
      if (!entry.riskLevels.includes(t.riskLevel)) entry.riskLevels.push(t.riskLevel);
    }
    res.json(Object.values(catMap));
  });

  r.get('/api/tools/:id', (req, res) => {
    const eng = getEngine();
    const tool = eng.toolkit.registry.get(req.params['id']!);
    if (!tool) { res.status(404).json({ error: 'tool-not-found' }); return; }
    const cfg = eng.configManager.load();
    const disabled = cfg.ui?.disabledTools || [];
    res.json({ ...tool, enabled: !disabled.includes(tool.id) });
  });

  r.put('/api/tools/:id', (req, res) => {
    try {
      const eng = getEngine();
      const tool = eng.toolkit.registry.get(req.params['id']!);
      if (!tool) { res.status(404).json({ error: 'tool-not-found' }); return; }
      const { enabled } = req.body as { enabled: boolean };
      const cfg = eng.configManager.load();
      const disabled = new Set(cfg.ui?.disabledTools || []);
      if (enabled) {
        disabled.delete(tool.id);
      } else {
        disabled.add(tool.id);
      }
      cfg.ui.disabledTools = [...disabled];
      eng.configManager.save(cfg);
      res.json({ id: tool.id, enabled });
    } catch (e) {
      getLogger().error('PUT_API_TOOLS_ID', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'tool-update-failed' });
    }
  });

  return r;
}
