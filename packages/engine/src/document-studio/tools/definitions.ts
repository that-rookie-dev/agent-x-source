/**
 * Document Studio — ToolDefinitions for the doc_* family (spec §9.7.3).
 *
 * riskLevel is sourced from DOC_STUDIO_TOOL_CATALOG so catalog and
 * definitions can never drift (I13). Long-running tools get generous
 * timeouts; non-idempotent run tools get maxRetries 0.
 */

import type { ToolDefinition, ToolParameterSchema } from '@agentx/shared';
import { DOC_STUDIO_TOOL_CATALOG } from './catalog.js';

const KB_SELECTOR_SCHEMA = {
  type: 'object',
  description: 'KB selector: {mode: ids|prefix|query|collection|tags, ...} (spec §11.1)',
} as const;

interface DefSeed {
  id: string;
  name: string;
  description: string;
  modelDescription: string;
  schema: ToolParameterSchema;
  composable?: boolean;
  isInteractive?: boolean;
  isDestructive?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

function def(seed: DefSeed): ToolDefinition {
  const entry = DOC_STUDIO_TOOL_CATALOG.find((e) => e.id === seed.id);
  if (!entry) throw new Error(`Tool ${seed.id} missing from DOC_STUDIO_TOOL_CATALOG (invariant I13)`);
  return {
    category: 'documents',
    riskLevel: entry.riskLevel,
    source: 'builtin',
    composable: seed.composable ?? true,
    ...seed,
  };
}

export const DOC_STUDIO_TOOL_DEFINITIONS: ToolDefinition[] = [
  // ─── Discovery & material (§9.1) ───
  def({
    id: 'doc_binder_list',
    name: 'List Binders',
    description: 'List Document Studio binders (input material bundles)',
    modelDescription: 'List Document Studio binders — named bundles of masters, KB selectors, answer sets, mappings and delivery plans. Use to discover prepared material before compiling a document job. Read-only.',
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Optional name filter' } }, required: [] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_binder_get',
    name: 'Get Binder',
    description: 'Get a binder with resolved slots',
    modelDescription: 'Fetch a Document Studio binder by id including slot resolution (masters, KB selectors, answer sets). Use when the user mentions @binder or before doc_job_compile. Read-only.',
    schema: { type: 'object', properties: { binderId: { type: 'string', description: 'Binder id' } }, required: ['binderId'] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_binder_create',
    name: 'Create Binder',
    description: 'Create a binder of input material',
    modelDescription: 'Create a Document Studio binder from role slots (layout_master, data_master, kb_selector, answers, mapping, recipe, delivery). Prefer binders over ad-hoc file paths so jobs are reproducible.',
    schema: { type: 'object', properties: { name: { type: 'string', description: 'Binder name' }, description: { type: 'string', description: 'Optional description' }, slots: { type: 'array', description: 'Array of {role, ...ref} slot objects' } }, required: ['name'] },
    isDestructive: true,
  }),
  def({
    id: 'doc_binder_update',
    name: 'Update Binder',
    description: 'Update binder slots or metadata',
    modelDescription: 'Update a Document Studio binder: add/remove slots, rename, change delivery plan. Session-scoped mutation; use doc_binder_get first to see current slots.',
    schema: { type: 'object', properties: { binderId: { type: 'string', description: 'Binder id' }, name: { type: 'string', description: 'New name' }, slots: { type: 'array', description: 'Full replacement slot array' } }, required: ['binderId'] },
    isDestructive: true,
  }),
  def({
    id: 'doc_master_list',
    name: 'List Masters',
    description: 'List Document Studio masters (layout/structure/standard/data/prior)',
    modelDescription: 'List masters in the Document Studio library with kind, format and analysis state. Replaces legacy template_list. Use before building binders or jobs. Read-only.',
    schema: { type: 'object', properties: { kind: { type: 'string', enum: ['layout', 'structure', 'standard', 'data', 'prior_artifact'], description: 'Filter by master kind' }, query: { type: 'string', description: 'Name/tag filter' } }, required: [] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_master_get',
    name: 'Get Master',
    description: 'Get master detail + analysis summary',
    modelDescription: 'Fetch a master with its AnalysisPackage summary: variables (with locator status), sections, constraints or data profile. Replaces legacy template_inspect. Never file_read the original upload instead. Read-only.',
    schema: { type: 'object', properties: { masterId: { type: 'string', description: 'Master id' } }, required: ['masterId'] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_master_upload',
    name: 'Upload Master',
    description: 'Register a workspace file as a Document Studio master from its path',
    modelDescription: 'Register a file from the workspace (PDF/DOCX/XLSX/CSV/MD/etc.) as a Document Studio master. Use this when the user attaches a file (@file[...]) and you need to replicate, fill, or clone it — the master must be registered before doc_job_compile/doc_job_run can use it. Returns the master id. Analysis starts automatically in the background. Use doc_master_analyze with wait=true to get variables+locators.',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute or workspace-relative path to the file' }, kind: { type: 'string', enum: ['layout', 'structure', 'standard', 'data', 'prior_artifact'], description: 'Master kind (auto-detected if omitted: PDF/DOCX/XLSX/PPTX → layout, CSV/JSON/YAML → data, MD/HTML → standard)' }, tags: { type: 'string', description: 'Comma-separated tags' } }, required: ['path'] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_master_analyze',
    name: 'Analyze Master',
    description: 'Enqueue or await analysis of a master',
    modelDescription: 'Run kind-specific analysis on a master (layout variables+locators, standard sections+constraints, data column profile). States are honest: awaiting_model means NOT ready — never treat heuristics as ready. May take a while.',
    schema: { type: 'object', properties: { masterId: { type: 'string', description: 'Master id' }, wait: { type: 'boolean', description: 'Wait for completion (default false)' } }, required: ['masterId'] },
    isDestructive: true,
    timeoutMs: 300_000,
    maxRetries: 0,
  }),
  def({
    id: 'doc_kb_select',
    name: 'Preview KB Selector',
    description: 'Preview knowledge-base selector hit counts and samples',
    modelDescription: 'Resolve a KB selector (ids | prefix | query | collection | tags) and preview hit counts plus sample chunks. Use to verify evidence coverage before authoring jobs. Read-only.',
    schema: { type: 'object', properties: { selector: KB_SELECTOR_SCHEMA }, required: ['selector'] },
    maxRetries: 1,
  }),

  // ─── Job lifecycle (§9.2) ───
  def({
    id: 'doc_recipe_list',
    name: 'List Recipes',
    description: 'List Document Studio recipes',
    modelDescription: 'List recipe templates (parameterized JobSpecs, e.g. interactive_fill, batch_merge, standard_author). Use to pick a starting point for doc_job_compile. Read-only.',
    schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Filter by generic pattern (P_fill, P_batch, ...)' } }, required: [] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_recipe_get',
    name: 'Get Recipe',
    description: 'Get a recipe with parameters and spec template',
    modelDescription: 'Fetch one recipe: parameters, step graph, and the JobSpec template it produces. Read-only.',
    schema: { type: 'object', properties: { recipeId: { type: 'string', description: 'Recipe id' } }, required: ['recipeId'] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_job_compile',
    name: 'Compile Job Spec',
    description: 'Compile natural language or structured intent into a draft JobSpec',
    modelDescription: 'Compile intent (free text + pinned inputs like binderId/masterIds/recipeId) into a validated draft JobSpec, reporting gaps as awaiting_input reasons. Compiling never composes or writes files. Follow with doc_job_create.',
    schema: { type: 'object', properties: { intent: { type: 'string', description: 'What to produce, in natural language' }, binderId: { type: 'string', description: 'Binder to draw inputs from' }, recipeId: { type: 'string', description: 'Recipe to parameterize' }, spec: { type: 'object', description: 'Structured JobSpec draft (alternative to intent)' }, mentions: { type: 'string', description: 'Free text containing @master/@binder/@dataset/@kb/@job mentions to pin as inputs' }, pinned: { type: 'object', description: 'Pre-resolved pinned input ids: masterIds (string[]), binderId, mappingId, answerSetId, kb (string[])' } }, required: [] },
    isInteractive: true,
    timeoutMs: 120_000,
  }),
  def({
    id: 'doc_job_create',
    name: 'Create Job',
    description: 'Persist a job from a compiled JobSpec or recipe+params',
    modelDescription: 'Create a Document Studio job from a JobSpec (from doc_job_compile) or recipeId+params. Accepts clientRequestId for idempotency. Returns jobId and initial status; run with doc_job_run.',
    schema: { type: 'object', properties: { title: { type: 'string', description: 'Job title' }, spec: { type: 'object', description: 'Compiled JobSpec' }, recipeId: { type: 'string', description: 'Recipe id (alternative to spec)' }, params: { type: 'object', description: 'Recipe parameters' }, clientRequestId: { type: 'string', description: 'Idempotency key' } }, required: [] },
    isDestructive: true,
  }),
  def({
    id: 'doc_job_get',
    name: 'Get Job',
    description: 'Get job status, progress and blockers',
    modelDescription: 'Fetch a job: status, step progress, blockers (missing keys, pending gates), artifacts so far. On awaiting_input the response names the exact tool that unblocks it. Read-only.',
    schema: { type: 'object', properties: { jobId: { type: 'string', description: 'Job id' } }, required: ['jobId'] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_job_list',
    name: 'List Jobs',
    description: 'List Document Studio jobs',
    modelDescription: 'List jobs with status and progress. Filter by status to find running or blocked jobs. Read-only.',
    schema: { type: 'object', properties: { status: { type: 'string', description: 'Filter by JobStatus' }, limit: { type: 'number', description: 'Max results (default 20)' } }, required: [] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_job_run',
    name: 'Run Job',
    description: 'Start or resume a job',
    modelDescription: 'Start or resume execution of a compiled job. May write many files under the delivery plan; batch sizes above the warning threshold require confirmation. Running an already-running job returns current status (no double-start). Replaces legacy template_fill.',
    schema: { type: 'object', properties: { jobId: { type: 'string', description: 'Job id' } }, required: ['jobId'] },
    isDestructive: true,
    composable: false,
    timeoutMs: 600_000,
    maxRetries: 0,
  }),
  def({
    id: 'doc_job_cancel',
    name: 'Cancel Job',
    description: 'Cancel a running job',
    modelDescription: 'Cooperatively cancel a job between instances. Already-delivered artifacts remain; the manifest records progress for later resume via doc_job_run.',
    schema: { type: 'object', properties: { jobId: { type: 'string', description: 'Job id' } }, required: ['jobId'] },
    composable: false,
    isDestructive: true,
    maxRetries: 0,
  }),
  def({
    id: 'doc_job_answer',
    name: 'Answer Interview',
    description: 'Submit interview answers for an awaiting job',
    modelDescription: 'Submit answers for unresolved required variables/sections on a job in awaiting_input. Values get provenance origin=user. Never invent values — ask the user, then call this.',
    schema: { type: 'object', properties: { jobId: { type: 'string', description: 'Job id' }, answers: { type: 'object', description: 'Map of variable key → value' } }, required: ['jobId', 'answers'] },
    isInteractive: true,
    maxRetries: 0,
  }),
  def({
    id: 'doc_job_confirm',
    name: 'Confirm Gate',
    description: 'Pass a review gate (mapping/dry_run/section/final)',
    modelDescription: 'Confirm or reject a pending review gate on a job. Gates block execution until confirmed; rejection returns the job to awaiting_input with reasons. Only confirm after the human has approved.',
    schema: { type: 'object', properties: { jobId: { type: 'string', description: 'Job id' }, gate: { type: 'string', enum: ['mapping', 'dry_run', 'section', 'final'], description: 'Gate to confirm' }, approve: { type: 'boolean', description: 'true=approve, false=reject' }, note: { type: 'string', description: 'Optional reviewer note' } }, required: ['jobId', 'gate', 'approve'] },
    isInteractive: true,
    maxRetries: 0,
  }),
  def({
    id: 'doc_mapping_propose',
    name: 'Propose Mapping',
    description: 'Auto-propose dataset column → variable mapping',
    modelDescription: 'Propose a mapping between a data master\'s columns and a fill schema\'s variables using names/types/samples, with confidence per entry. Confirm with doc_mapping_set before batch runs.',
    schema: { type: 'object', properties: { dataMasterId: { type: 'string', description: 'Data master id' }, layoutMasterId: { type: 'string', description: 'Layout master whose variables to map to' } }, required: ['dataMasterId', 'layoutMasterId'] },
    timeoutMs: 120_000,
  }),
  def({
    id: 'doc_mapping_set',
    name: 'Set Mapping',
    description: 'Save/confirm a dataset↔schema mapping',
    modelDescription: 'Persist and confirm a column→variable mapping (from doc_mapping_propose, possibly edited). Confirmation clears the mapping gate for batch jobs.',
    schema: { type: 'object', properties: { mappingId: { type: 'string', description: 'Existing mapping id (update)' }, dataMasterId: { type: 'string', description: 'Data master id' }, schemaRef: { type: 'string', description: 'Variable schema reference' }, entries: { type: 'array', description: 'Array of {column, variableKey, transform?}' }, confirmed: { type: 'boolean', description: 'Mark mapping confirmed' } }, required: ['entries'] },
    isDestructive: true,
    maxRetries: 0,
  }),
  def({
    id: 'doc_dry_run',
    name: 'Dry Run',
    description: 'Compose the first K instances as previews',
    modelDescription: 'Compose the first K instances of a batch job (default from policies.dryRunCount) to preview paths and rendered output before the full run. Always propose this when N exceeds the dry-run count.',
    schema: { type: 'object', properties: { jobId: { type: 'string', description: 'Job id' }, count: { type: 'number', description: 'Instances to preview (default policy dryRunCount)' } }, required: ['jobId'] },
    composable: false,
    timeoutMs: 300_000,
    maxRetries: 0,
  }),

  // ─── Outputs (§9.3) ───
  def({
    id: 'doc_artifact_list',
    name: 'List Artifacts',
    description: 'List artifacts produced by a job',
    modelDescription: 'List artifacts for a job with paths, formats and instance indexes. Voice output is summarized. Read-only.',
    schema: { type: 'object', properties: { jobId: { type: 'string', description: 'Job id' }, limit: { type: 'number', description: 'Max results (default 50)' } }, required: ['jobId'] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_manifest_get',
    name: 'Get Manifest',
    description: 'Get the batch manifest for a job',
    modelDescription: 'Fetch the per-instance manifest of a batch job: ok/failed/skipped rows with errors. Use to report results or drive failures-only re-runs. Read-only.',
    schema: { type: 'object', properties: { jobId: { type: 'string', description: 'Job id' } }, required: ['jobId'] },
    maxRetries: 1,
  }),
  def({
    id: 'doc_open_path',
    name: 'Open Output Path',
    description: 'Open a delivered artifact or folder in the workspace',
    modelDescription: 'Open/reveal a delivered artifact path in the system viewer. Workspace-scoped only — not a bypass to read raw master uploads.',
    schema: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative delivered path' } }, required: ['path'] },
    composable: false,
    maxRetries: 0,
  }),
];
