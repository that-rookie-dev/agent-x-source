/**
 * Document Studio — Domain Model (spec §5).
 *
 * Constitutional invariants (spec §2) enforced at the type level where possible:
 *  - I3  Locate-or-don't-claim: `Variable.locator` is required for fill schemas.
 *  - I4  Honest analysis: `AnalysisState` includes `awaiting_model`; heuristics never become `ready`.
 *  - I5  Policy over improvisation: `JobPolicies.inventFacts` is the literal type `false`.
 *  - I7  Provenance: every bound value carries a `Provenance` record.
 */

// ─── Masters ────────────────────────────────────────────────────────────────

export type MasterKind = 'layout' | 'structure' | 'standard' | 'data' | 'prior_artifact';

export type MasterFormat = 'docx' | 'pdf' | 'xlsx' | 'pptx' | 'csv' | 'md' | 'html' | 'json' | 'yaml' | 'mmd' | 'tex' | 'other';

export type AnalysisState =
  | 'pending' // accepted, not started
  | 'awaiting_model' // model/config unavailable — NOT ready
  | 'analyzing'
  | 'ready' // AnalysisPackage trusted for its kind
  | 'partial' // usable with warnings (explicit)
  | 'failed';

export interface Master {
  id: string;
  name: string;
  kind: MasterKind; // classified; user-overridable
  format: MasterFormat;
  mimeType: string;
  storageId: string; // attachment / blob id
  checksum: string;
  version: number;
  analysis: AnalysisPackage | null;
  analysisState: AnalysisState;
  analysisError?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Analysis ───────────────────────────────────────────────────────────────

export interface SectionOutline {
  id: string;
  title: string;
  level: number;
  required?: boolean;
  children?: SectionOutline[];
}

export interface TableOutline {
  id: string;
  title?: string;
  page?: number;
  rows: number;
  cols: number;
  headers?: string[];
}

/**
 * Visual layout map produced by the vision-aware analyzer (PDF render → LLM).
 * Captures ground-truth page geometry and region bboxes so the model can reason
 * about the exact design of a master, and so dense-table cell extraction (Phase 3)
 * can align text items to a grid. Coordinates are in PDF points (origin bottom-left
 * for y, matching pdfjs/pdf-lib convention used elsewhere in the engine).
 */
export interface LayoutRegion {
  id: string;
  page: number;
  type: 'header' | 'footer' | 'title' | 'label' | 'value' | 'table' | 'table_cell' | 'rule' | 'note' | 'other';
  text?: string; // text content (verbatim where possible)
  x: number;
  y: number;
  width: number;
  height: number;
  role?: string; // semantic role, e.g. 'employee_name', 'month_total', 'tax_slab'
}

export interface LayoutTableGrid {
  id: string;
  page: number;
  /** Bounding box of the whole table. */
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  /** Row labels (left-most column text), aligned to row index. */
  rowLabels?: string[];
  /** Column headers (top row text), aligned to column index. */
  colHeaders?: string[];
  /** Detected x-coordinates of column boundaries (cols+1 entries, ascending). */
  colX?: number[];
  /** Detected y-coordinates of row boundaries (rows+1 entries, ascending). */
  rowY?: number[];
}

export interface LayoutMap {
  pages: Array<{
    page: number;
    widthPt: number;
    heightPt: number;
    orientation: 'landscape' | 'portrait';
  }>;
  regions: LayoutRegion[];
  tables: LayoutTableGrid[];
  /** Source of the map: 'vision' (LLM saw rendered PNGs) | 'text' (text-only fallback). */
  source: 'vision' | 'text';
}

export interface ColumnProfile {
  name: string;
  datatype: 'string' | 'number' | 'date' | 'boolean' | 'unknown';
  nullable: boolean;
  distinctSample?: unknown[];
  sensitivity?: Sensitivity;
}

export interface Constraint {
  id: string;
  kind: 'section_required' | 'citation' | 'rule' | 'schema' | 'consistency';
  description: string;
  ref?: string;
}

export interface AnalysisPackage {
  kind: MasterKind;
  documentType: string; // form | statement | letter | report | guideline | dataset | ...
  summary: string; // human/agent brief — never the "design" itself
  confidence: number; // 0..1
  warnings: string[];

  // layout / structure
  layout?: {
    pageCount?: number;
    sections: SectionOutline[];
    tables: TableOutline[];
    chrome: string[]; // fixed headers/footers/brands — do not treat as variables
  };
  /** Visual layout map from the vision-aware analyzer (PDF masters). */
  layoutMap?: LayoutMap;
  variables?: Variable[]; // fill schema

  // standard / guideline
  constraints?: Constraint[];
  requiredSections?: SectionOutline[];

  // structure master
  sections?: SectionOutline[];

  // data profile
  dataProfile?: {
    columns: ColumnProfile[];
    rowCount: number;
    sampleRows: Record<string, unknown>[];
  };
}

// ─── Variables & locators ──────────────────────────────────────────────────

export type VariableDatatype = 'string' | 'number' | 'date' | 'boolean' | 'enum' | 'money' | 'richtext';

export type AskPolicy = 'ask' | 'derive' | 'from_dataset' | 'from_kb' | 'from_prior' | 'optional_blank';

export type Sensitivity = 'none' | 'pii' | 'financial' | 'health';

export interface ValidationRule {
  kind: 'regex' | 'range' | 'enum' | 'length' | 'custom';
  spec: Record<string, unknown>;
  message?: string;
}

export type Locator =
  | { type: 'placeholder'; token: string } // {{key}}
  | { type: 'bookmark'; name: string } // docx
  | { type: 'content_control'; tag: string }
  | { type: 'sample_text'; text: string; context?: string }
  | { type: 'pdf_region'; page: number; x: number; y: number; width: number; height?: number; fontSize?: number }
  | { type: 'sheet_cell'; sheet: string; cell: string }
  | { type: 'table_cell'; tableId: string; row: number; col: number };

/**
 * Fill schema variable. I3: a variable without a locator may exist on a
 * *structure* schema for authoring prompts but can never be used by `fill_clone`.
 */
export interface Variable {
  key: string; // semantic snake_case
  label: string;
  datatype: VariableDatatype;
  required: boolean;
  askPolicy: AskPolicy;
  locator: Locator | null; // REQUIRED (non-null) for fill_clone
  validation?: ValidationRule[];
  sensitivity: Sensitivity;
  sampleValue?: string; // from master, for locate/replace
  description?: string;
}

// ─── KB selectors ───────────────────────────────────────────────────────────

export type KbSelector =
  | { mode: 'ids'; sourceIds: string[] }
  | { mode: 'prefix'; prefix: string } // A3_1048_2026_
  | { mode: 'query'; text: string; topK?: number; sourceIds?: string[] }
  | { mode: 'collection'; collectionId: string }
  | { mode: 'tags'; tags: string[]; match: 'all' | 'any' };

// ─── Binders ────────────────────────────────────────────────────────────────

export type BinderSlot =
  | { role: 'layout_master'; masterId: string }
  | { role: 'structure_master'; masterId: string }
  | { role: 'standard_master'; masterId: string }
  | { role: 'data_master'; masterId: string }
  | { role: 'prior_artifact'; masterId: string }
  | { role: 'kb_selector'; selector: KbSelector }
  | { role: 'answers'; answerSetId: string }
  | { role: 'mapping'; mappingId: string }
  | { role: 'recipe'; recipeId: string }
  | { role: 'delivery'; deliveryPlanId: string };

export interface Binder {
  id: string;
  name: string;
  description?: string;
  slots: BinderSlot[];
  createdAt: string;
  updatedAt: string;
}

// ─── Bindings ───────────────────────────────────────────────────────────────

export type ProvenanceOrigin = 'user' | 'dataset' | 'kb' | 'derived' | 'prior' | 'blank' | 'tool';

export interface Provenance {
  origin: ProvenanceOrigin;
  ref?: string; // row id, chunk id, formula id
  confidence?: number;
  at: string;
}

export interface BindingError {
  key: string;
  code: string;
  message: string;
}

export interface BindingSet {
  id: string;
  schemaRef: string; // hash/id of variable/section schema used
  values: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  unresolved: string[]; // keys still missing
  errors: BindingError[];
}

// ─── Authoring ──────────────────────────────────────────────────────────────

export interface EvidenceChunk {
  id: string;
  sourceId: string;
  sourceName: string;
  content: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface EvidenceSet {
  id: string;
  selector: KbSelector;
  chunks: EvidenceChunk[];
  links?: EvidenceLink[]; // section -> chunk citation mapping for authoring
}

export interface EvidenceLink {
  sectionId: string;
  chunkIds: string[];
}

export interface Fact {
  id: string;
  text: string;
  source: string;
  type: 'entity' | 'event' | 'claim' | 'obligation';
  confidence: number; // 0..1
}

export interface SectionDraft {
  sectionId: string;
  title: string;
  content: string;
  citations: EvidenceLink[];
  status: 'drafted' | 'approved' | 'rejected';
}

// ─── Answer sets & mappings ─────────────────────────────────────────────────

export interface AnswerSet {
  id: string;
  values: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  createdAt: string;
  updatedAt: string;
}

export interface MappingEntry {
  column: string;
  variableKey: string;
  transform?: string; // coercion / formula id
  confidence?: number;
}

export interface CoercionPreview {
  column: string;
  variableKey: string;
  fromType: string;
  toType: string;
  error?: string;
  sample?: unknown;
}

export interface Mapping {
  id: string;
  dataMasterId: string;
  schemaRef: string;
  entries: MappingEntry[];
  confirmed: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Computed by {@link validateMapping} — not persisted directly. */
  coercionPreview?: CoercionPreview[];
  /** Validation warnings for the mapping (duplicates, missing required vars, type mismatches). */
  validationWarnings?: string[];
}

// ─── Instances (cardinality) ────────────────────────────────────────────────

export interface GroupingRule {
  key: string; // dataset column / derived key
  as: string; // path segment name
}

/** Path template DSL, e.g. `{Dept}/{EmployeeId}/{MasterStem}-{index}.{ext}` */
export type NamingTemplate = string;

export interface MasterRule {
  when?: { column: string; equals?: unknown; matches?: string };
  predicate?: string;
  masterId: string;
}

export type InstanceFilter =
  | { kind: 'all' }
  | { kind: 'predicate'; expression: string }
  | { kind: 'exclude_predicate'; expression: string }
  | { kind: 'failures_only'; manifestId: string };

export type InstanceStatus =
  | 'planned'
  | 'pending'
  | 'running'
  | 'bound'
  | 'completed'
  | 'composed'
  | 'delivered'
  | 'failed'
  | 'skipped'
  | 'filtered'
  | 'grouped';

export interface InstanceSpec {
  index: number;
  bindingSetId?: string; // filled as bind proceeds
  path: string; // relative workspace path
  masterId: string; // allows conditional masters
  status: InstanceStatus;
  error?: string;
}

export interface InstancePlan {
  id: string;
  instances: InstanceSpec[]; // may be large; store paginated
  grouping: GroupingRule[];
  naming: NamingTemplate;
}

// ─── JobSpec ────────────────────────────────────────────────────────────────

export type ComposeStyle = 'fill_clone' | 'assemble' | 'author' | 'merge_pack' | 'transform' | 'markdown' | 'html' | 'json' | 'yaml' | 'diagram' | 'latex';

export type TransformOp = 'translate' | 'redact' | 'watermark' | 'diff_redline' | 'split' | 'restyle' | 'normalize';

export type ReviewGateKind = 'mapping' | 'dry_run' | 'section' | 'final';

export interface DeriveRule {
  key: string;
  formula: string; // e.g. `prior.total * 1.05`
  description?: string;
}

export interface ValidateCheck {
  kind: 'schema' | 'guideline_sections' | 'cite_coverage' | 'cross_doc' | 'business_rule' | 'completeness';
  spec?: Record<string, unknown>;
}

export type DeliveryTarget =
  | { kind: 'single'; path: string }
  | { kind: 'tree'; base: string; naming: NamingTemplate }
  | { kind: 'zip'; path: string }
  | { kind: 'dual'; tree: { base: string; naming: NamingTemplate }; zip: { path: string } }
  | { kind: 'hold_for_release'; releaseTo: string };

export type JobInputRef =
  | { type: 'master'; masterId: string; role: MasterKind }
  | { type: 'binder'; binderId: string }
  | { type: 'kb'; selector: KbSelector }
  | { type: 'answer_set'; answerSetId: string }
  | { type: 'mapping'; mappingId: string }
  | { type: 'workspace_hint'; path: string };

export type JobStep =
  | { op: 'analyze'; masterId: string }
  | { op: 'select_evidence'; selector: KbSelector; as: string }
  | { op: 'extract_facts'; from: string; as: string; schemaHint?: string; model?: string }
  | { op: 'map_schema'; from: string; to: 'variables' | 'sections'; mappingId?: string; requireConfirm?: boolean }
  | { op: 'interview'; schema: 'variables' | 'sections'; only?: 'unresolved_required' }
  | { op: 'derive'; rules: DeriveRule[] }
  | {
      op: 'plan_instances';
      cardinality: '1' | 'N';
      grouping?: GroupingRule[];
      naming: NamingTemplate;
      masterRules?: MasterRule[];
      filter?: InstanceFilter;
    }
  | { op: 'compose'; style: ComposeStyle; transformOp?: TransformOp; adapterHints?: Record<string, unknown> }
  | { op: 'validate'; checks: ValidateCheck[] }
  | { op: 'review_gate'; gate: ReviewGateKind }
  | { op: 'deliver'; target: DeliveryTarget };

export type JobStepOp = JobStep['op'];

/**
 * Policies (spec §5.9). I5: `inventFacts` is the literal type `false` — it is
 * not a toggle anywhere in the product.
 */
export interface JobPolicies {
  missingRequired: 'ask' | 'fail' | 'blank'; // blank only if explicitly allowed per-variable
  missingOptional: 'blank' | 'omit_section';
  inventFacts: false; // constant false — cannot enable
  citations: 'off' | 'preferred' | 'required';
  pii: 'allow' | 'vault' | 'refuse_export';
  overwrite: 'fail' | 'version' | 'replace';
  partialBatch: 'allow' | 'fail_job';
  maxInstances?: number;
  batchWarningThreshold?: number; // default 100; UI/tools warn/confirm above this
  dryRunCount?: number; // e.g. 3
}

export const JOB_SPEC_VERSION = 1 as const;

/** Declarative, versioned, serializable. Chat and UI both compile to this. */
export interface JobSpec {
  version: typeof JOB_SPEC_VERSION;
  intent: string; // free text for humans/agents
  inputs: JobInputRef[];
  steps: JobStep[]; // ordered DAG (v1: linear + optional gates)
  policies: JobPolicies;
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'draft'
  | 'compiled'
  | 'awaiting_input' // interview / mapping / approval
  | 'dry_run'
  | 'running'
  | 'partial' // some instances failed
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ArtifactRef {
  artifactId: string;
  path: string;
}

export interface Job {
  id: string;
  title: string;
  status: JobStatus;
  spec: JobSpec;
  recipeId?: string;
  binderId?: string;
  progress: { done: number; total: number; detail?: string };
  artifacts: ArtifactRef[];
  manifestId?: string;
  stepResults?: Record<string, unknown>;
  error?: string;
  cancelled?: boolean;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Artifacts & manifests ──────────────────────────────────────────────────

export interface Artifact {
  id: string;
  jobId: string;
  instanceIndex?: number;
  path: string; // workspace-relative
  storageId?: string;
  format: string;
  checksum: string;
  bindingSetId?: string;
  evidenceMap?: EvidenceLink[]; // author mode
  createdAt: string;
}

export interface ManifestRow {
  index: number;
  path: string;
  status: 'ok' | 'failed' | 'skipped';
  error?: string;
  artifactId?: string;
}

export interface Manifest {
  id: string;
  jobId: string;
  rows: ManifestRow[]; // per instance
  summary: { ok: number; failed: number; skipped: number };
}

// ─── Recipes ────────────────────────────────────────────────────────────────

export interface RecipeParameter {
  key: string;
  description: string;
  required: boolean;
}

export interface Recipe {
  id: string; // e.g. 'interactive_fill'
  name: string;
  description: string;
  pattern: 'P_fill' | 'P_batch' | 'P_author' | 'P_pack' | 'P_transform' | 'P_validate' | 'P_hybrid';
  parameters: RecipeParameter[];
  /** Template producing a JobSpec once parameters are bound. */
  specTemplate: JobSpec;
}

// ─── Structured error codes (spec §9.7.9) ───────────────────────────────────

export const DOC_STUDIO_ERROR_CODES = [
  'DOC_STUDIO_UNAVAILABLE',
  'NOT_IMPLEMENTED',
  'INVALID_ARGS',
  'JOB_NOT_FOUND',
  'MASTER_NOT_FOUND',
  'BINDER_NOT_FOUND',
  'AWAITING_INPUT',
  'GATE_REQUIRED',
  'ANALYSIS_NOT_READY',
  'POLICY_DENIED',
  'MAX_INSTANCES',
  'SPEC_INVALID',
] as const;

export type DocStudioErrorCode = (typeof DOC_STUDIO_ERROR_CODES)[number];
