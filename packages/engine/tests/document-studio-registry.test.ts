/**
 * Document Studio — registry parity tests (spec §9.7.11, invariants I11/I13).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { ToolExecutor } from '../src/tools/ToolExecutor.js';
import {
  DOC_STUDIO_TOOL_CATALOG,
  DOC_STUDIO_TOOL_IDS,
} from '../src/document-studio/tools/catalog.js';
import { DOC_STUDIO_TOOL_DEFINITIONS } from '../src/document-studio/tools/definitions.js';
import { DOC_STUDIO_TOOL_HANDLERS } from '../src/document-studio/tools/handlers/index.js';
import {
  assertDocStudioFamilyComplete,
  registerDocumentStudioTools,
  unregisterDocumentStudioTools,
} from '../src/document-studio/tools/register.js';
import { setDocumentStudioService, DocumentStudioService } from '../src/document-studio/DocumentStudioService.js';
import { createDefaultToolkit } from '../src/tools/toolkit.js';

function freshToolkit() {
  const registry = new ToolRegistry();
  const executor = new ToolExecutor(registry, process.cwd());
  return { registry, executor };
}

afterEach(() => setDocumentStudioService(null));

describe('DOC_STUDIO_TOOL_CATALOG completeness (I13)', () => {
  it('every catalog id has a definition and a handler, with no orphans', () => {
    expect(() => assertDocStudioFamilyComplete()).not.toThrow();
    const catalogIds = DOC_STUDIO_TOOL_IDS.slice().sort();
    expect(DOC_STUDIO_TOOL_DEFINITIONS.map((d) => d.id).sort()).toEqual(catalogIds);
    expect(Object.keys(DOC_STUDIO_TOOL_HANDLERS).sort()).toEqual(catalogIds);
  });

  it('all ids use the doc_<resource>_<verb-ish> naming and documents category', () => {
    for (const def of DOC_STUDIO_TOOL_DEFINITIONS) {
      expect(def.id).toMatch(/^doc_[a-z_]+$/);
      expect(def.category).toBe('documents');
      expect(def.source).toBe('builtin');
      expect(def.modelDescription.length).toBeGreaterThan(20);
    }
  });

  it('riskLevel in definitions matches the catalog', () => {
    for (const def of DOC_STUDIO_TOOL_DEFINITIONS) {
      const entry = DOC_STUDIO_TOOL_CATALOG.find((e) => e.id === def.id);
      expect(entry, def.id).toBeDefined();
      expect(def.riskLevel).toBe(entry!.riskLevel);
    }
  });

  it('run/cancel/dry-run tools are non-retryable and non-composable', () => {
    for (const id of ['doc_job_run', 'doc_job_cancel', 'doc_dry_run']) {
      const def = DOC_STUDIO_TOOL_DEFINITIONS.find((d) => d.id === id)!;
      expect(def.maxRetries).toBe(0);
      expect(def.composable).toBe(false);
    }
  });
});

describe('registerDocumentStudioTools', () => {
  it('registers the whole family atomically on registry + executor', () => {
    const { registry, executor } = freshToolkit();
    registerDocumentStudioTools(registry, executor);
    for (const id of DOC_STUDIO_TOOL_IDS) {
      expect(registry.has(id), id).toBe(true);
      expect(executor.hasHandler(id), id).toBe(true);
    }
  });

  it('is idempotent when called twice', () => {
    const { registry, executor } = freshToolkit();
    registerDocumentStudioTools(registry, executor);
    expect(() => registerDocumentStudioTools(registry, executor)).not.toThrow();
    expect(registry.list().filter((t) => t.id.startsWith('doc_')).length).toBe(DOC_STUDIO_TOOL_IDS.length);
  });

  it('no-ops when disabled', () => {
    const { registry, executor } = freshToolkit();
    registerDocumentStudioTools(registry, executor, { enabled: false });
    expect(registry.list().filter((t) => t.id.startsWith('doc_')).length).toBe(0);
  });

  it('supports surgical disable without removing lifecycle tools implicitly', () => {
    const { registry, executor } = freshToolkit();
    registerDocumentStudioTools(registry, executor, { disabledIds: ['doc_open_path'] });
    expect(registry.has('doc_open_path')).toBe(false);
    expect(registry.has('doc_job_run')).toBe(true);
    expect(registry.has('doc_job_answer')).toBe(true);
    expect(registry.has('doc_job_confirm')).toBe(true);
  });

  it('teardown removes exactly the family', () => {
    const { registry, executor } = freshToolkit();
    registerDocumentStudioTools(registry, executor);
    const removed = unregisterDocumentStudioTools(registry, executor);
    expect(removed.sort()).toEqual(DOC_STUDIO_TOOL_IDS.slice().sort());
    expect(registry.list().filter((t) => t.id.startsWith('doc_')).length).toBe(0);
  });
});

describe('default toolkit bootstrap', () => {
  it('wires doc_* into createDefaultToolkit', () => {
    const { registry, executor } = createDefaultToolkit(process.cwd());
    for (const id of DOC_STUDIO_TOOL_IDS) {
      expect(registry.has(id), id).toBe(true);
      expect(executor.hasHandler(id), id).toBe(true);
    }
  });

  it('legacy generator tools no longer squat the doc_ prefix', () => {
    const { registry } = createDefaultToolkit(process.cwd());
    for (const legacy of ['doc_markdown', 'doc_html', 'doc_json', 'doc_yaml', 'doc_diagram', 'doc_latex']) {
      expect(registry.has(legacy), legacy).toBe(false);
    }
    for (const renamed of ['gen_markdown', 'gen_html', 'gen_json', 'gen_yaml', 'gen_diagram', 'gen_latex']) {
      expect(registry.has(renamed), renamed).toBe(true);
    }
  });
});

describe('stub handler honesty (Phase 0)', () => {
  const ctx = { sessionId: 't', scopePath: process.cwd(), timeout: 5000 } as never;

  it('returns DOC_STUDIO_UNAVAILABLE when service is not booted', async () => {
    setDocumentStudioService(null);
    const result = await DOC_STUDIO_TOOL_HANDLERS['doc_job_run']({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('DOC_STUDIO_UNAVAILABLE');
  });

  it('returns NOT_IMPLEMENTED (never fake success) when service is booted', async () => {
    setDocumentStudioService(new DocumentStudioService({ pool: {} as never }));
    const implemented = new Set(DOC_STUDIO_TOOL_IDS);
    for (const id of DOC_STUDIO_TOOL_IDS.filter((t) => !implemented.has(t))) {
      const result = await DOC_STUDIO_TOOL_HANDLERS[id]({}, ctx);
      expect(result.success, id).toBe(false);
      expect(result.error, id).toBe('NOT_IMPLEMENTED');
    }
  });
});

describe('tool annotations (I13)', () => {
  it('mutating tools are flagged isDestructive', () => {
    for (const id of ['doc_binder_create', 'doc_binder_update', 'doc_master_analyze', 'doc_job_create', 'doc_job_run', 'doc_job_cancel', 'doc_mapping_set']) {
      const def = DOC_STUDIO_TOOL_DEFINITIONS.find((d) => d.id === id)!;
      expect(def.isDestructive, id).toBe(true);
    }
  });

  it('interactive tools are flagged isInteractive', () => {
    for (const id of ['doc_job_answer', 'doc_job_confirm', 'doc_job_compile']) {
      const def = DOC_STUDIO_TOOL_DEFINITIONS.find((d) => d.id === id)!;
      expect(def.isInteractive, id).toBe(true);
    }
  });
});

describe('createDefaultToolkit documentStudioTools config', () => {
  it('honors disabledIds from the toolkit config', () => {
    const { registry } = createDefaultToolkit(process.cwd(), {
      documentStudioTools: { disabledIds: ['doc_open_path'] },
    });
    expect(registry.has('doc_open_path')).toBe(false);
    expect(registry.has('doc_job_run')).toBe(true);
  });

  it('honors voiceDisabledIds from the toolkit config', () => {
    const { registry } = createDefaultToolkit(process.cwd(), {
      documentStudioTools: { voiceDisabledIds: ['doc_kb_select'] },
    });
    expect(registry.has('doc_kb_select')).toBe(false);
    expect(registry.has('doc_job_answer')).toBe(true);
  });

  it('removes legacy template_* tools when legacyTemplateTools is false', () => {
    const { registry, executor } = createDefaultToolkit(process.cwd(), {
      documentStudioTools: { legacyTemplateTools: false },
    });
    for (const id of ['template_list', 'template_inspect', 'template_fill']) {
      expect(registry.has(id), id).toBe(false);
      expect(executor.hasHandler(id), id).toBe(false);
    }
  });

  it('shims legacy template_* tools when legacyTemplateTools is "shim"', async () => {
    const { registry, executor } = createDefaultToolkit('/tmp', {
      documentStudioTools: { legacyTemplateTools: 'shim' },
    });
    const ctx = { sessionId: 't', scopePath: '/tmp', timeout: 5000 } as never;
    const expected = {
      template_list: 'doc_master_list',
      template_inspect: 'doc_master_get',
      template_fill: 'doc_job_run',
    } as const;
    for (const [id, replacement] of Object.entries(expected)) {
      expect(registry.has(id), id).toBe(true);
      const handler = executor.getHandlers().get(id);
      expect(handler, id).toBeDefined();
      const result = await handler!({}, ctx);
      expect(result.success, id).toBe(false);
      expect(result.error, id).toBe('DEPRECATED');
      expect(result.output, id).toContain(replacement);
    }
  });
});
