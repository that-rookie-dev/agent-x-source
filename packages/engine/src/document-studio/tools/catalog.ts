/**
 * Document Studio — DOC_STUDIO_TOOL_CATALOG (spec §9.7.4).
 *
 * Single source of truth for the doc_* tool family. Drives ToolDefinition
 * registration, MCP tools/list (Phase 7), the Studio "Agent tools" panel,
 * and the §9.6 completeness checklist. Registry completeness is invariant
 * I13: every entry here MUST have a definition and a handler, registered
 * together — CI enforces this (see document-studio-registry test).
 *
 * NOTE on prefix ownership: the pre-existing generator tools formerly named
 * doc_markdown/doc_html/... were renamed to gen_* so the doc_ prefix belongs
 * exclusively to Document Studio.
 */

export type DocStudioToolGroup = 'material' | 'job' | 'mapping' | 'output' | 'admin';
export type DocStudioToolChannel = 'chat' | 'voice' | 'ui';
export type DocStudioToolAvailability = 'ga' | 'beta' | 'deprecated';

export interface DocStudioToolCatalogEntry {
  id: string;
  group: DocStudioToolGroup;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  channels: DocStudioToolChannel[]; // default all
  availability: DocStudioToolAvailability;
  replaces?: string[]; // e.g. ['template_fill']
  minSpecVersion: string; // JobSpec / module version
}

export const DOC_STUDIO_CATALOG_VERSION = '0.5.0';

const ALL: DocStudioToolChannel[] = ['chat', 'voice', 'ui'];

export const DOC_STUDIO_TOOL_CATALOG: DocStudioToolCatalogEntry[] = [
  // ─── §9.1 Discovery & material ───
  { id: 'doc_binder_list', group: 'material', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_binder_get', group: 'material', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_binder_create', group: 'material', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_binder_update', group: 'material', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_master_list', group: 'material', riskLevel: 'low', channels: ALL, availability: 'beta', replaces: ['template_list'], minSpecVersion: '1' },
  { id: 'doc_master_get', group: 'material', riskLevel: 'low', channels: ALL, availability: 'beta', replaces: ['template_inspect'], minSpecVersion: '1' },
  { id: 'doc_master_upload', group: 'material', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_master_analyze', group: 'material', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_kb_select', group: 'material', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },

  // ─── §9.2 Job lifecycle ───
  { id: 'doc_recipe_list', group: 'job', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_recipe_get', group: 'job', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_job_compile', group: 'job', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_job_create', group: 'job', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_job_get', group: 'job', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_job_list', group: 'job', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_job_run', group: 'job', riskLevel: 'high', channels: ALL, availability: 'beta', replaces: ['template_fill'], minSpecVersion: '1' },
  { id: 'doc_job_cancel', group: 'job', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_job_answer', group: 'job', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_job_confirm', group: 'job', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_mapping_propose', group: 'mapping', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_mapping_set', group: 'mapping', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_dry_run', group: 'job', riskLevel: 'high', channels: ALL, availability: 'beta', minSpecVersion: '1' },

  // ─── §9.3 Outputs ───
  { id: 'doc_artifact_list', group: 'output', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_manifest_get', group: 'output', riskLevel: 'low', channels: ALL, availability: 'beta', minSpecVersion: '1' },
  { id: 'doc_open_path', group: 'output', riskLevel: 'medium', channels: ALL, availability: 'beta', minSpecVersion: '1' },
];

export const DOC_STUDIO_TOOL_IDS: string[] = DOC_STUDIO_TOOL_CATALOG.map((e) => e.id);
