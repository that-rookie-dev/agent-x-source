/**
 * Document Studio — static recipe catalog (Phase 5/6, spec §5.7).
 */

import type { JobSpec, JobStep, JobPolicies, JobInputRef, KbSelector } from '../types.js';

export interface RecipeMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  phases: string[];
  /** Step descriptors like "op:style" or just "op". */
  steps: string[];
  defaultPolicies?: Partial<JobPolicies>;
  parameters?: import('../types.js').RecipeParameter[];
}

export const RECIPE_CATALOG: RecipeMeta[] = [
  { id: 'r1', name: 'Fill one document from chat', description: 'Single layout master + chat-provided answers (Phase 3).', tags: ['interactive'], phases: ['Phase 3'], steps: ['analyze', 'interview', 'compose:fill_clone', 'deliver:single'] },
  {
    id: 'r2',
    name: 'Batch mail-merge',
    description: 'Data master mapped to layout; one artifact per row (Phase 4).',
    tags: ['batch'],
    phases: ['Phase 4'],
    steps: ['analyze:data_master', 'analyze:layout_master', 'map_schema', 'plan_instances', 'compose:fill_clone', 'deliver:batch'],
    parameters: [
      { key: 'data_master', description: 'Data master id (CSV/dataset)', required: true },
      { key: 'layout_master', description: 'Default layout master id', required: true },
      { key: 'mapping', description: 'Pinned mapping id (skips map_schema when provided)', required: false },
      { key: 'group_by', description: 'Comma-separated columns to group instances by', required: false },
      { key: 'master_rules', description: 'JSON list of {predicate, master_id} for conditional layout selection', required: false },
      { key: 'filter', description: 'include:/exclude: predicate expression, e.g. \'exclude: status=="draft"\'', required: false },
      { key: 'delivery', description: 'Output delivery mode: tree, zip, or tree+zip/dual', required: false },
    ],
  },
  {
    id: 'r3',
    name: 'Evidence author',
    description: 'Compose a standard-compliant document from evidence snippets, real citations, and optional layout skin (Phase 5).',
    tags: ['authoring'],
    phases: ['Phase 5'],
    steps: ['analyze:standard_master', 'analyze:layout_master', 'select_evidence', 'extract_facts', 'interview', 'derive', 'compose:author', 'validate', 'review_gate:section', 'review_gate:final', 'deliver:single'],
    parameters: [
      { key: 'standard_master', description: 'Standard/guideline master id used as the authoring source', required: true },
      { key: 'layout_master', description: 'Optional layout/skin master id used to render the authored document', required: false },
      { key: 'kb', description: 'Pinned knowledge base ids (comma-separated) used to select evidence', required: false },
      { key: 'output_format', description: 'Desired output format/delivery mode hint', required: false },
    ],
  },
  {
    id: 'r4',
    name: 'Skin author',
    description: 'Author a document using a skin/layout master plus a content master.',
    tags: ['authoring'],
    phases: ['Phase 5'],
    steps: ['analyze:skin_master', 'analyze:content_master', 'compose:author', 'validate', 'deliver:single'],
    parameters: [
      { key: 'skin_master', description: 'Layout master id used as the document skin', required: true },
      { key: 'content_master', description: 'Content master id to author into the skin', required: true },
    ],
  },
  {
    id: 'r5',
    name: 'Delta revise',
    description: 'Compare a prior artifact against a new master and produce a redline or restyled revision.',
    tags: ['authoring', 'diff'],
    phases: ['Phase 5'],
    steps: ['analyze:new_master', 'compose:diff_redline', 'deliver:single'],
    parameters: [
      { key: 'prior_artifact', description: 'Existing artifact/master to use as the baseline', required: true },
      { key: 'new_master', description: 'New master/version to compare against the prior artifact', required: true },
    ],
  },
  {
    id: 'r6',
    name: 'Rollup',
    description: 'Merge multiple masters of the same kind into one packed output.',
    tags: ['batch', 'merge'],
    phases: ['Phase 5'],
    steps: ['compose:merge_pack', 'deliver:single'],
    parameters: [
      { key: 'masters', description: 'Comma-separated list of master ids to roll up', required: true },
    ],
  },
  {
    id: 'r7',
    name: 'Validate only',
    description: 'Run validation checks on inputs and stop without composing or delivering.',
    tags: ['validate'],
    phases: ['Phase 5'],
    steps: ['validate'],
    parameters: [
      { key: 'check_kind', description: 'Validation check kind to run', required: false },
    ],
  },
  { id: 'r8', name: 'Markdown report', description: 'Render a templated Markdown report.', tags: ['render'], phases: ['Phase 6'], steps: ['compose:markdown', 'deliver:single'] },
  { id: 'r9', name: 'HTML preview', description: 'Render HTML from a layout+data binder.', tags: ['render'], phases: ['Phase 6'], steps: ['compose:html', 'deliver:single'] },
  { id: 'r10', name: 'JSON data export', description: 'Produce a JSON document from structured answers.', tags: ['render'], phases: ['Phase 6'], steps: ['compose:json', 'deliver:single'] },
  { id: 'r11', name: 'YAML data export', description: 'Produce a YAML document from structured answers.', tags: ['render'], phases: ['Phase 6'], steps: ['compose:yaml', 'deliver:single'] },
  { id: 'r12', name: 'Diagram generation', description: 'Render a Mermaid/Graphviz diagram from data.', tags: ['render'], phases: ['Phase 6'], steps: ['compose:diagram', 'deliver:single'] },
  { id: 'r13', name: 'LaTeX document', description: 'Render a LaTeX-formatted document from a layout.', tags: ['render'], phases: ['Phase 6'], steps: ['compose:latex', 'deliver:single'] },
  {
    id: 'r14',
    name: 'Conditional batch — single condition',
    description: 'Batch mail-merge filtered by a single predicate.',
    tags: ['batch', 'conditional'],
    phases: ['Phase 6'],
    steps: ['analyze:data_master', 'analyze:layout_master', 'map_schema', 'plan_instances', 'compose:fill_clone', 'deliver:batch'],
    parameters: [
      { key: 'data_master', description: 'Data master id', required: true },
      { key: 'layout_master', description: 'Layout master id', required: true },
      { key: 'condition', description: 'Predicate expression to filter rows', required: true },
      { key: 'mapping', description: 'Pinned mapping id', required: false },
    ],
  },
  {
    id: 'r15',
    name: 'Conditional batch — grouped',
    description: 'Batch mail-merge grouped and filtered by a predicate.',
    tags: ['batch', 'conditional'],
    phases: ['Phase 6'],
    steps: ['analyze:data_master', 'analyze:layout_master', 'map_schema', 'plan_instances', 'compose:fill_clone', 'deliver:batch'],
    parameters: [
      { key: 'data_master', description: 'Data master id', required: true },
      { key: 'layout_master', description: 'Layout master id', required: true },
      { key: 'condition', description: 'Predicate expression to filter rows', required: true },
      { key: 'group_by', description: 'Comma-separated columns to group instances by', required: true },
    ],
  },
  {
    id: 'r16',
    name: 'Conditional batch — multi-master rules',
    description: 'Conditional batch with per-row layout-master selection rules.',
    tags: ['batch', 'conditional'],
    phases: ['Phase 6'],
    steps: ['analyze:data_master', 'analyze:layout_master', 'map_schema', 'plan_instances', 'compose:fill_clone', 'deliver:batch'],
    parameters: [
      { key: 'data_master', description: 'Data master id', required: true },
      { key: 'layout_master', description: 'Default layout master id', required: true },
      { key: 'condition', description: 'Predicate expression to filter rows', required: false },
      { key: 'master_rules', description: 'JSON list of {predicate, master_id} for conditional layout selection', required: true },
    ],
  },
  {
    id: 'r17',
    name: 'Multi-master merge — 2-way',
    description: 'Merge two masters and resolve conflicts.',
    tags: ['merge', 'conflicts'],
    phases: ['Phase 6'],
    steps: ['compose:merge_pack', 'deliver:single'],
    parameters: [
      { key: 'masters', description: 'Comma-separated master ids to merge', required: true },
      { key: 'conflict_strategy', description: 'Conflict resolution strategy: first, union, manual', required: false },
    ],
  },
  {
    id: 'r18',
    name: 'Multi-master merge — N-way',
    description: 'Merge many masters with a configurable conflict strategy.',
    tags: ['merge', 'conflicts'],
    phases: ['Phase 6'],
    steps: ['compose:merge_pack', 'deliver:single'],
    parameters: [
      { key: 'masters', description: 'Comma-separated master ids to merge', required: true },
      { key: 'conflict_strategy', description: 'Conflict resolution strategy: first, union, manual', required: true },
    ],
  },
  {
    id: 'r19',
    name: 'Multi-master merge — cross-kind',
    description: 'Merge masters of different kinds and resolve conflicts.',
    tags: ['merge', 'conflicts'],
    phases: ['Phase 6'],
    steps: ['compose:merge_pack', 'deliver:single'],
    parameters: [
      { key: 'masters', description: 'Comma-separated master ids of mixed kinds', required: true },
      { key: 'conflict_strategy', description: 'Conflict resolution strategy: first, union, manual', required: true },
      { key: 'kind_hints', description: 'Comma-separated kind hints matching masters', required: false },
    ],
  },
  {
    id: 'r20',
    name: 'Translate + restyle chain',
    description: 'Translate a source document and restyle it.',
    tags: ['transform', 'chain'],
    phases: ['Phase 6'],
    steps: ['analyze:source_master', 'compose:translate', 'compose:restyle', 'deliver:single'],
    parameters: [
      { key: 'prior_artifact', description: 'Source master id to transform', required: true },
      { key: 'new_master', description: 'Target layout or reference master', required: false },
      { key: 'target_lang', description: 'Target language code', required: true },
    ],
  },
  {
    id: 'r21',
    name: 'Redact + watermark chain',
    description: 'Redact sensitive content and apply a watermark.',
    tags: ['transform', 'chain'],
    phases: ['Phase 6'],
    steps: ['analyze:source_master', 'compose:redact', 'compose:watermark', 'deliver:single'],
    parameters: [
      { key: 'prior_artifact', description: 'Source master id to transform', required: true },
      { key: 'redact_terms', description: 'Comma-separated terms to redact', required: false },
      { key: 'watermark_text', description: 'Watermark text', required: false },
    ],
  },
  {
    id: 'r22',
    name: 'Normalize + split chain',
    description: 'Normalize a document and split it into sections.',
    tags: ['transform', 'chain'],
    phases: ['Phase 6'],
    steps: ['analyze:source_master', 'compose:normalize', 'compose:split', 'deliver:single'],
    parameters: [
      { key: 'prior_artifact', description: 'Source master id to transform', required: true },
      { key: 'split_marker', description: 'Section delimiter or marker', required: false },
    ],
  },
  {
    id: 'r23',
    name: 'Validation suite — schema + completeness',
    description: 'Run schema and completeness checks on a master.',
    tags: ['validate', 'suite'],
    phases: ['Phase 6'],
    steps: ['analyze:target_master', 'validate'],
    parameters: [
      { key: 'target_master', description: 'Master id to validate', required: true },
    ],
  },
  {
    id: 'r24',
    name: 'Validation suite — guideline + citations',
    description: 'Run guideline-section and citation-coverage checks.',
    tags: ['validate', 'suite'],
    phases: ['Phase 6'],
    steps: ['analyze:target_master', 'validate'],
    parameters: [
      { key: 'target_master', description: 'Master id to validate', required: true },
      { key: 'standard_master', description: 'Guideline or standard master id for context', required: false },
    ],
  },
  {
    id: 'r25',
    name: 'Validation suite — cross-doc + business rules',
    description: 'Run cross-document consistency and business-rule checks.',
    tags: ['validate', 'suite'],
    phases: ['Phase 6'],
    steps: ['analyze:target_master', 'validate'],
    parameters: [
      { key: 'target_master', description: 'Primary master id to validate', required: true },
      { key: 'reference_masters', description: 'Comma-separated reference master ids', required: false },
    ],
  },
  {
    id: 'r26',
    name: 'Dual-approve author',
    description: 'Author a document with section and final approval gates.',
    tags: ['approve', 'workflow'],
    phases: ['Phase 6'],
    steps: ['analyze:standard_master', 'analyze:layout_master', 'compose:author', 'validate', 'review_gate:section', 'review_gate:final', 'deliver:single'],
    parameters: [
      { key: 'standard_master', description: 'Standard/guideline master id', required: true },
      { key: 'layout_master', description: 'Layout master id', required: true },
      { key: 'approvers', description: 'Comma-separated approver identifiers', required: false },
    ],
  },
  {
    id: 'r27',
    name: 'Dual-approve batch',
    description: 'Batch mail-merge with dry-run and final approval gates.',
    tags: ['approve', 'workflow', 'batch'],
    phases: ['Phase 6'],
    steps: ['analyze:data_master', 'analyze:layout_master', 'map_schema', 'plan_instances', 'compose:fill_clone', 'review_gate:dry_run', 'review_gate:final', 'deliver:batch'],
    parameters: [
      { key: 'data_master', description: 'Data master id', required: true },
      { key: 'layout_master', description: 'Layout master id', required: true },
      { key: 'approvers', description: 'Comma-separated approver identifiers', required: false },
    ],
  },
  {
    id: 'r28',
    name: 'Dual-approve merge',
    description: 'Merge multiple masters with section and final approval gates.',
    tags: ['approve', 'workflow', 'merge'],
    phases: ['Phase 6'],
    steps: ['compose:merge_pack', 'review_gate:section', 'review_gate:final', 'deliver:single'],
    parameters: [
      { key: 'masters', description: 'Comma-separated master ids to merge', required: true },
      { key: 'approvers', description: 'Comma-separated approver identifiers', required: false },
    ],
  },
  {
    id: 'r29',
    name: 'Data kit',
    description: 'Assemble a batch from a predefined set of data masters.',
    tags: ['kit', 'batch'],
    phases: ['Phase 6'],
    steps: ['compose:assemble', 'deliver:batch'],
    parameters: [
      { key: 'kit_masters', description: 'Comma-separated kit master ids', required: true },
    ],
  },
  {
    id: 'r30',
    name: 'Layout kit',
    description: 'Assemble a single document from a predefined set of layout masters.',
    tags: ['kit', 'assemble'],
    phases: ['Phase 6'],
    steps: ['compose:assemble', 'deliver:single'],
    parameters: [
      { key: 'kit_masters', description: 'Comma-separated kit master ids', required: true },
    ],
  },
  {
    id: 'r31',
    name: 'Full kit',
    description: 'Assemble, validate, and deliver a complete kit as a zip.',
    tags: ['kit', 'assemble'],
    phases: ['Phase 6'],
    steps: ['compose:assemble', 'validate', 'deliver:zip'],
    parameters: [
      { key: 'kit_masters', description: 'Comma-separated kit master ids', required: true },
    ],
  },
  {
    id: 'r32',
    name: 'Replicate document',
    description: 'Clone a filled layout master exactly (preserving design — page size, orientation, fonts, table grid, rules) and replace cell values with new values. Values can come from: (a) direct user input via doc_job_answer, (b) derive formulas referencing prior cell values (e.g. prior[\'basic__april\'] * 1.15 for forecasts, prior[\'price\'] * rate for price updates, lookup tables for corrections), or (c) a data master via map_schema for batch replication. Uses fill_clone to overlay new values at exact cell coordinates.',
    tags: ['replicate', 'clone', 'copy', 'fill_clone'],
    phases: ['Phase 7'],
    // derive is optional — only included when derived_rules parameter is provided.
    // The compileRecipeToSpec builder strips it if no rules are supplied.
    steps: ['analyze:layout_master', 'derive?', 'compose:fill_clone', 'review_gate:dry_run', 'deliver:single'],
    parameters: [
      { key: 'layout_master', description: 'The filled layout master to replicate (PDF/DOCX/XLSX). Its design is cloned; only cell values change.', required: true },
      { key: 'derived_rules', description: 'Optional JSON array of {key, formula} derive rules. Formulas reference prior cell values (prior[\'key\']), lookup tables, Math, Date, etc. Omit if providing values directly via doc_job_answer.', required: false },
      { key: 'output_format', description: 'Output format hint (defaults to the master format)', required: false },
    ],
  },
];

function parse(s: string): Partial<JobStep> & { optional?: boolean } {
  // Trailing "?" marks a step as optional — the builder may strip it if the
  // required parameters are not supplied (e.g. derive? when no derived_rules).
  let optional = false;
  if (s.endsWith('?')) { optional = true; s = s.slice(0, -1); }
  const result = parseStep(s);
  (result as { optional?: boolean }).optional = optional;
  return result as Partial<JobStep> & { optional?: boolean };
}

function parseStep(s: string): Partial<JobStep> {
  const [op, styleOrKind] = s.split(':');
  if (op === 'compose') {
    const transformOps: readonly string[] = ['translate', 'redact', 'watermark', 'diff_redline', 'split', 'restyle', 'normalize'];
    if (styleOrKind && transformOps.includes(styleOrKind)) {
      return { op: 'compose', style: 'transform', transformOp: styleOrKind } as Partial<JobStep>;
    }
    return { op: 'compose', style: styleOrKind ?? 'fill_clone' } as Partial<JobStep>;
  }
  if (op === 'deliver') {
    const kind = styleOrKind === 'batch' ? 'tree' : (styleOrKind ?? 'single');
    return { op: 'deliver', target: kind === 'tree' ? { kind: 'tree', base: 'out', naming: '{{index}}' } : { kind: 'single', path: 'out' } };
  }
  if (op === 'analyze') return { op: 'analyze', masterId: styleOrKind ?? '' };
  if (op === 'interview') return { op: 'interview', schema: 'variables' };
  if (op === 'map_schema') return { op: 'map_schema', from: '', to: 'variables' };
  if (op === 'plan_instances') return { op: 'plan_instances', cardinality: '1', naming: '{{index}}' };
  if (op === 'derive') return { op: 'derive', rules: [] };
  if (op === 'validate') {
    const validateKinds: readonly string[] = ['schema', 'guideline_sections', 'cite_coverage', 'cross_doc', 'business_rule', 'completeness'];
    const kind = styleOrKind && validateKinds.includes(styleOrKind) ? styleOrKind : 'completeness';
    return { op: 'validate', checks: [{ kind }] } as Partial<JobStep>;
  }
  if (op === 'review_gate') {
    const gates = ['mapping', 'dry_run', 'section', 'final'] as const;
    const gate = styleOrKind && gates.includes(styleOrKind as any) ? styleOrKind : 'final';
    return { op: 'review_gate', gate } as Partial<JobStep>;
  }
  if (op === 'select_evidence') return { op: 'select_evidence', selector: { mode: 'query', text: '' }, as: '' };
  if (op === 'extract_facts') return { op: 'extract_facts', from: '', as: '' };
  return { op } as Partial<JobStep>;
}

function fillStepDefaults(step: JobStep): void {
  const s = step as unknown as Record<string, unknown>;
  if (step.op === 'select_evidence') {
    if (!s['as']) s['as'] = 'evidence';
    if (!s['selector']) s['selector'] = { mode: 'query', text: '' };
  }
  if (step.op === 'extract_facts') {
    if (!s['from']) s['from'] = 'evidence';
    if (!s['as']) s['as'] = 'facts';
  }
  if (step.op === 'derive') {
    if (!Array.isArray(s['rules']) || (s['rules'] as unknown[]).length === 0) {
      s['rules'] = [{ key: 'default', formula: '', description: 'Placeholder derived field' }];
    }
  }
  if (step.op === 'map_schema') {
    if (!s['from']) s['from'] = 'default-data-master';
    if (s['to'] !== 'variables' && s['to'] !== 'sections') s['to'] = 'variables';
  }
  if (step.op === 'plan_instances') {
    if (s['cardinality'] !== '1' && s['cardinality'] !== 'N') s['cardinality'] = 'N';
    if (typeof s['naming'] !== 'string' || !s['naming']) s['naming'] = '{{index}}';
  }
  if (step.op === 'validate') {
    if (!Array.isArray(s['checks']) || (s['checks'] as unknown[]).length === 0) {
      s['checks'] = [{ kind: 'completeness' }];
    }
  }
  if (step.op === 'review_gate') {
    if (!['mapping', 'dry_run', 'section', 'final'].includes(s['gate'] as string)) s['gate'] = 'final';
  }
  if (step.op === 'compose' && s['style'] === 'transform' && !s['transformOp']) {
    s['transformOp'] = 'translate';
  }
}

export function compileRecipeToSpec(recipeId: string, params: { intent?: string; masterIds?: Record<string, string>; kbSelector?: KbSelector } = {}): JobSpec | null {
  const recipe = RECIPE_CATALOG.find((r) => r.id === recipeId);
  if (!recipe) return null;
  let steps = recipe.steps.map(parse) as (JobStep & { optional?: boolean })[];
  // R3 only analyzes a layout master when one is pinned.
  if (recipeId === 'r3') {
    steps = steps.filter((st) => !(st.op === 'analyze' && (st as unknown as { masterId?: string }).masterId === 'layout_master' && !params.masterIds?.layout_master));
  }
  // Strip optional steps whose required parameters are not supplied.
  // e.g. r32's derive? is removed when no derived_rules parameter is provided
  // — the user is supplying values directly via doc_job_answer instead.
  steps = steps.filter((st) => {
    if (!st.optional) return true;
    if (st.op === 'derive') {
      const raw = params.masterIds?.derived_rules;
      if (!raw) return false; // no derive rules → skip the derive step
    }
    return true;
  });
  if (params.masterIds) {
    for (const step of steps) {
      const s = step as unknown as Record<string, unknown>;
      if (step.op === 'analyze') {
        const placeholder = params.masterIds[step.masterId];
        if (placeholder) {
          step.masterId = placeholder;
        } else if (!step.masterId) {
          const fallback = params.masterIds.layout_master;
          if (fallback) step.masterId = fallback;
        }
      }
      if (step.op === 'select_evidence') {
        s['as'] = 'evidence';
        if (params.kbSelector) {
          s['selector'] = params.kbSelector;
        } else if (params.masterIds.kb) {
          s['selector'] = { mode: 'ids', sourceIds: params.masterIds.kb.split(',').map((id) => id.trim()) };
        }
      }
      if (step.op === 'extract_facts') {
        s['from'] = 'evidence';
        s['as'] = 'facts';
      }
      if (step.op === 'interview') {
        s['only'] = 'unresolved_required';
      }
      if (step.op === 'derive') {
        const raw = params.masterIds.derived_rules;
        let rules: { key: string; formula: string; description?: string }[] = [];
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              rules = parsed as { key: string; formula: string; description?: string }[];
            }
          } catch { /* ignore invalid derive rules */ }
        }
        if (rules.length === 0) {
          rules = [{ key: 'default', formula: '', description: 'Placeholder derived field' }];
        }
        s['rules'] = rules;
      }
      if (step.op === 'map_schema') { s['from'] = params.masterIds.data_master ?? s['from']; s['dataMasterId'] = params.masterIds.data_master; s['layoutMasterId'] = params.masterIds.layout_master; s['mappingId'] = params.masterIds.mapping; }
      if (step.op === 'plan_instances') { s['dataMasterId'] = params.masterIds.data_master; s['layoutMasterId'] = params.masterIds.layout_master; }
      if (step.op === 'compose') {
        const hints = buildComposeHints(params.masterIds, step.style, step.transformOp);
        if (Object.keys(hints).length > 0) s['adapterHints'] = hints;
      }
      if (step.op === 'validate') {
        if (recipeId === 'r3') {
          s['checks'] = [
            { kind: 'completeness' },
            { kind: 'guideline_sections' },
            { kind: 'cite_coverage' },
            { kind: 'business_rule' },
          ];
        } else if (params.masterIds.check_kind) {
          s['checks'] = [{ kind: params.masterIds.check_kind }];
        }
      }
      if (step.op === 'deliver' && recipeId === 'r3' && params.masterIds.output_format) {
        const fmt = params.masterIds.output_format.trim();
        if (fmt === 'zip') {
          s['target'] = { kind: 'zip', path: 'out/author.zip' };
        }
      }
    }
  }
  const inputs: JobInputRef[] = [];
  if (recipeId === 'r2' && params.masterIds) {
    const masterIds = params.masterIds;
    const dataMaster = masterIds.data_master ?? '';
    const layoutMaster = masterIds.layout_master ?? '';

    // Parse optional conditional master rules and collect extra layout masters
    const masterRules: { predicate: string; masterId: string }[] = [];
    const extraLayoutIds = new Set<string>();
    if (masterIds.master_rules) {
      try {
        const parsed = JSON.parse(masterIds.master_rules) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === 'object' && typeof item.predicate === 'string' && typeof item.master_id === 'string') {
              masterRules.push({ predicate: item.predicate, masterId: item.master_id });
              extraLayoutIds.add(item.master_id);
            }
          }
        }
      } catch { /* ignore malformed master_rules */ }
    }

    // Analyze any layout masters referenced by master rules
    let lastAnalyzeIndex = -1;
    for (let i = 0; i < steps.length; i += 1) {
      if (steps[i]!.op === 'analyze') lastAnalyzeIndex = i;
    }
    for (const mid of extraLayoutIds) {
      if (mid !== layoutMaster) {
        const insertAt = lastAnalyzeIndex === -1 ? 0 : lastAnalyzeIndex + 1;
        steps.splice(insertAt, 0, { op: 'analyze', masterId: mid });
        lastAnalyzeIndex = insertAt;
      }
    }

    // If a mapping is pinned, skip the map_schema step and reference the mapping
    const mappingId = masterIds.mapping;
    if (mappingId) {
      const mapIdx = steps.findIndex((st) => st.op === 'map_schema');
      if (mapIdx !== -1) steps.splice(mapIdx, 1);
      inputs.push({ type: 'mapping', mappingId });
    }

    // Configure plan_instances with grouping, conditional rules, and filter
    const planStep = steps.find((st) => st.op === 'plan_instances');
    if (planStep) {
      const s = planStep as unknown as Record<string, unknown>;
      s['cardinality'] = 'N';
      const groupByRaw = masterIds.group_by ?? '';
      const grouping = groupByRaw
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
        .map((c) => ({ key: c, as: c }));
      s['grouping'] = grouping;
      if (masterRules.length > 0) s['masterRules'] = masterRules;
      if (masterIds.filter) {
        const raw = masterIds.filter.trim();
        if (raw.toLowerCase().startsWith('exclude:')) {
          s['filter'] = { kind: 'exclude_predicate', expression: raw.slice(8).trim() };
        } else {
          s['filter'] = {
            kind: 'predicate',
            expression: raw.toLowerCase().startsWith('include:') ? raw.slice(8).trim() : raw,
          };
        }
      }
      if (mappingId) s['mappingId'] = mappingId;
      if (dataMaster) s['dataMasterId'] = dataMaster;
      if (layoutMaster) s['layoutMasterId'] = layoutMaster;

      // Add a compose:assemble step when grouping is requested
      if (grouping.length > 0) {
        const deliverIdx = steps.findIndex((st) => st.op === 'deliver');
        if (deliverIdx !== -1) {
          steps.splice(deliverIdx, 0, { op: 'compose', style: 'assemble' } as JobStep);
        } else {
          steps.push({ op: 'compose', style: 'assemble' } as JobStep);
        }
      }
    }

    // Override delivery target based on the delivery parameter
    const deliverStep = steps.find((st) => st.op === 'deliver');
    if (deliverStep) {
      const d = (masterIds.delivery ?? 'tree').toLowerCase();
      if (d === 'zip') {
        (deliverStep as unknown as Record<string, unknown>)['target'] = { kind: 'zip', path: 'out/batch.zip' };
      } else if (d === 'tree+zip' || d === 'dual') {
        (deliverStep as unknown as Record<string, unknown>)['target'] = {
          kind: 'dual',
          tree: { base: 'out', naming: '{{index}}' },
          zip: { path: 'out/batch.zip' },
        };
      } else {
        (deliverStep as unknown as Record<string, unknown>)['target'] = { kind: 'tree', base: 'out', naming: '{{index}}' };
      }
    }
  }

  // Extended R14–R31 recipe compilation
  const EXTRA_RECIPE_IDS = new Set([
    'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r20', 'r21', 'r22',
    'r23', 'r24', 'r25', 'r26', 'r27', 'r28', 'r29', 'r30', 'r31',
  ]);
  if (EXTRA_RECIPE_IDS.has(recipeId)) {
    const masterIds = params.masterIds ?? {};

    // Conditional batches R14–R16
    if (recipeId === 'r14' || recipeId === 'r15' || recipeId === 'r16') {
      const plan = steps.find((s) => s.op === 'plan_instances') as unknown as Record<string, unknown> | undefined;
      if (plan) {
        plan['cardinality'] = 'N';
        plan['dataMasterId'] = masterIds.data_master ?? 'data-master';
        plan['layoutMasterId'] = masterIds.layout_master ?? 'layout-master';
        if (masterIds.group_by) {
          plan['grouping'] = masterIds.group_by
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length > 0)
            .map((c) => ({ key: c, as: c }));
        }
        if (masterIds.condition) {
          const raw = masterIds.condition.trim();
          if (raw.toLowerCase().startsWith('exclude:')) {
            plan['filter'] = { kind: 'exclude_predicate', expression: raw.slice(8).trim() };
          } else {
            plan['filter'] = {
              kind: 'predicate',
              expression: raw.toLowerCase().startsWith('include:') ? raw.slice(8).trim() : raw,
            };
          }
        }
      }
      if (recipeId === 'r16' && masterIds.master_rules) {
        try {
          const parsed = JSON.parse(masterIds.master_rules) as unknown;
          if (Array.isArray(parsed)) {
            const masterRules = parsed
              .filter((item: any) => item && typeof item === 'object' && typeof item.predicate === 'string' && typeof item.master_id === 'string')
              .map((item: any) => ({ predicate: item.predicate, masterId: item.master_id }));
            if (plan) plan['masterRules'] = masterRules;
            for (const rule of masterRules) {
              if (rule.masterId !== (masterIds.layout_master ?? '')) {
                const composeIdx = steps.findIndex((s) => s.op === 'compose');
                steps.splice(composeIdx >= 0 ? composeIdx : 0, 0, { op: 'analyze', masterId: rule.masterId } as JobStep);
              }
            }
          }
        } catch { /* ignore malformed master_rules */ }
      }
      const mapStep = steps.find((s) => s.op === 'map_schema') as unknown as Record<string, unknown> | undefined;
      if (mapStep) {
        mapStep['from'] = masterIds.data_master ?? 'data-master';
        mapStep['to'] = 'variables';
        mapStep['dataMasterId'] = masterIds.data_master ?? 'data-master';
        mapStep['layoutMasterId'] = masterIds.layout_master ?? 'layout-master';
      }
    }

    // Multi-master merge with conflicts R17–R19
    if (['r17', 'r18', 'r19'].includes(recipeId)) {
      const masters = (masterIds.masters ?? 'm1,m2').split(',').map((m) => m.trim()).filter((m) => m.length > 0);
      const composeIdx = steps.findIndex((s) => s.op === 'compose');
      const insertAt = composeIdx >= 0 ? composeIdx : 0;
      for (const mid of [...masters].reverse()) {
        steps.splice(insertAt, 0, { op: 'analyze', masterId: mid } as JobStep);
      }
      const compose = steps.find((s) => s.op === 'compose') as unknown as Record<string, unknown> | undefined;
      if (compose) {
        compose['adapterHints'] = {
          ...((compose['adapterHints'] as Record<string, unknown> | undefined) ?? {}),
          masterIds: masters,
          conflictStrategy: masterIds.conflict_strategy ?? 'union',
        };
      }
    }

    // Transform / render chains R20–R22
    if (['r20', 'r21', 'r22'].includes(recipeId)) {
      const sourceMaster = masterIds.prior_artifact ?? masterIds.source_master ?? 'source-master';
      const targetMaster = masterIds.new_master ?? 'target-master';
      for (const step of steps) {
        if (step.op === 'compose') {
          const s = step as unknown as Record<string, unknown>;
          s['adapterHints'] = {
            ...((s['adapterHints'] as Record<string, unknown> | undefined) ?? {}),
            priorMasterId: sourceMaster,
            newMasterId: targetMaster,
            transformOp: s['transformOp'] ?? 'translate',
          };
        }
      }
    }

    // Validation-only suites R23–R25
    if (['r23', 'r24', 'r25'].includes(recipeId)) {
      const validateStep = steps.find((s) => s.op === 'validate') as unknown as Record<string, unknown> | undefined;
      if (validateStep) {
        if (recipeId === 'r23') validateStep['checks'] = [{ kind: 'schema' }, { kind: 'completeness' }];
        if (recipeId === 'r24') validateStep['checks'] = [{ kind: 'guideline_sections' }, { kind: 'cite_coverage' }];
        if (recipeId === 'r25') validateStep['checks'] = [{ kind: 'cross_doc' }, { kind: 'business_rule' }];
      }
      const analyze = steps.find((s) => s.op === 'analyze') as unknown as Record<string, unknown> | undefined;
      if (analyze) analyze['masterId'] = masterIds.target_master ?? 'target-master';
    }

    // Dual-approve workflows R26–R28
    if (['r26', 'r27', 'r28'].includes(recipeId)) {
      const sectionGate = steps.find((s) => s.op === 'review_gate' && (s as unknown as Record<string, unknown>)['gate'] === 'section') as JobStep | undefined;
      const finalGate = steps.find((s) => s.op === 'review_gate' && (s as unknown as Record<string, unknown>)['gate'] === 'final') as JobStep | undefined;
      const deliverIdx = steps.findIndex((s) => s.op === 'deliver');
      if (!sectionGate && deliverIdx !== -1) {
        steps.splice(deliverIdx, 0, { op: 'review_gate', gate: 'section' } as JobStep);
      }
      if (!finalGate && deliverIdx !== -1) {
        steps.splice(deliverIdx, 0, { op: 'review_gate', gate: 'final' } as JobStep);
      }
      const approvers = (masterIds.approvers ?? 'lead')
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      for (const s of steps) {
        if (s.op === 'review_gate') {
          (s as unknown as Record<string, unknown>)['approvers'] = approvers;
        }
      }
      if (recipeId === 'r27') {
        const plan = steps.find((s) => s.op === 'plan_instances') as unknown as Record<string, unknown> | undefined;
        if (plan) {
          plan['cardinality'] = 'N';
          plan['dataMasterId'] = masterIds.data_master ?? 'data-master';
          plan['layoutMasterId'] = masterIds.layout_master ?? 'layout-master';
        }
        const mapStep = steps.find((s) => s.op === 'map_schema') as unknown as Record<string, unknown> | undefined;
        if (mapStep) {
          mapStep['from'] = masterIds.data_master ?? 'data-master';
          mapStep['dataMasterId'] = masterIds.data_master ?? 'data-master';
          mapStep['layoutMasterId'] = masterIds.layout_master ?? 'layout-master';
        }
        const deliver = steps.find((s) => s.op === 'deliver') as unknown as Record<string, unknown> | undefined;
        if (deliver) deliver['target'] = { kind: 'tree', base: 'out', naming: '{{index}}' };
      }
    }

    // Kits (predefined master sets) R29–R31
    if (['r29', 'r30', 'r31'].includes(recipeId)) {
      const kitMasters = (masterIds.kit_masters ?? 'k1,k2').split(',').map((m) => m.trim()).filter((m) => m.length > 0);
      const composeIdx = steps.findIndex((s) => s.op === 'compose');
      const insertAt = composeIdx >= 0 ? composeIdx : 0;
      for (const mid of [...kitMasters].reverse()) {
        steps.splice(insertAt, 0, { op: 'analyze', masterId: mid } as JobStep);
      }
      const compose = steps.find((s) => s.op === 'compose') as unknown as Record<string, unknown> | undefined;
      if (compose) {
        compose['adapterHints'] = {
          ...((compose['adapterHints'] as Record<string, unknown> | undefined) ?? {}),
          kitMasters,
        };
      }
      if (recipeId === 'r31') {
        const validate = { op: 'validate', checks: [{ kind: 'completeness' }] } as JobStep;
        const deliverIdx = steps.findIndex((s) => s.op === 'deliver');
        if (deliverIdx !== -1) steps.splice(deliverIdx, 0, validate);
        const deliver = steps.find((s) => s.op === 'deliver') as unknown as Record<string, unknown> | undefined;
        if (deliver) deliver['target'] = { kind: 'zip', path: 'out/kit.zip' };
      }
    }
  }

  for (const step of steps) fillStepDefaults(step);

  const policies: JobPolicies = { missingRequired: 'ask', missingOptional: 'blank', inventFacts: false, citations: recipeId === 'r3' ? 'required' : 'off', pii: 'allow', overwrite: 'fail', partialBatch: 'allow' };
  // Strip the internal `optional` flag from steps before returning.
  const cleanSteps = steps.map(({ optional: _opt, ...rest }) => rest) as JobStep[];
  return {
    version: 1,
    intent: params.intent ?? recipe.description,
    inputs,
    steps: cleanSteps,
    policies,
  };
}

function buildComposeHints(masterIds: Record<string, string>, style?: string, transformOp?: string): Record<string, unknown> {
  if (style === 'author' && masterIds.standard_master) {
    return {
      standardMasterId: masterIds.standard_master,
      layoutMasterId: masterIds.layout_master,
      factsRef: 'facts',
      evidenceRef: 'evidence',
    };
  }
  if (style === 'author' && masterIds.skin_master && masterIds.content_master) {
    return { skinMasterId: masterIds.skin_master, contentMasterId: masterIds.content_master };
  }
  if (style === 'transform' && masterIds.prior_artifact && masterIds.new_master) {
    return { priorMasterId: masterIds.prior_artifact, newMasterId: masterIds.new_master, transformOp: transformOp ?? 'diff_redline' };
  }
  if (style === 'merge_pack' && masterIds.masters) {
    return { masterIds: masterIds.masters.split(',').map((m) => m.trim()) };
  }
  return {};
}
