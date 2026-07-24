/**
 * Document Studio — JobSpec schema validation (spec §5.8, §5.9, §7.4).
 *
 * Validation is the compile-time gate: a JobSpec that does not validate can
 * never reach the runner. This enforces I5 (inventFacts constant false) and
 * structural sanity for the linear-DAG v1 step model.
 */

import {
  JOB_SPEC_VERSION,
  type ComposeStyle,
  type JobPolicies,
  type JobSpec,
  type JobStep,
  type TransformOp,
} from './types.js';

export interface SpecValidationIssue {
  path: string; // e.g. 'steps[2].transformOp'
  code: string;
  message: string;
}

export interface SpecValidationResult {
  ok: boolean;
  issues: SpecValidationIssue[];
}

const COMPOSE_STYLES: ComposeStyle[] = [
  'fill_clone',
  'assemble',
  'author',
  'merge_pack',
  'transform',
  'markdown',
  'html',
  'json',
  'yaml',
  'diagram',
  'latex',
];
const TRANSFORM_OPS: TransformOp[] = ['translate', 'redact', 'watermark', 'diff_redline', 'split', 'restyle', 'normalize'];
const STEP_OPS = [
  'analyze',
  'select_evidence',
  'extract_facts',
  'map_schema',
  'interview',
  'derive',
  'plan_instances',
  'compose',
  'validate',
  'review_gate',
  'deliver',
] as const;

export const DEFAULT_BATCH_WARNING_THRESHOLD = 100;

export function defaultJobPolicies(overrides?: Partial<Omit<JobPolicies, 'inventFacts'>>): JobPolicies {
  return {
    missingRequired: 'ask',
    missingOptional: 'blank',
    inventFacts: false,
    citations: 'off',
    pii: 'allow',
    overwrite: 'fail',
    partialBatch: 'allow',
    batchWarningThreshold: DEFAULT_BATCH_WARNING_THRESHOLD,
    ...overrides,
  };
}

function issue(path: string, code: string, message: string): SpecValidationIssue {
  return { path, code, message };
}

function validatePolicies(policies: unknown, issues: SpecValidationIssue[]): void {
  if (!policies || typeof policies !== 'object') {
    issues.push(issue('policies', 'POLICIES_MISSING', 'JobSpec.policies is required'));
    return;
  }
  const p = policies as Record<string, unknown>;
  // I5 — inventFacts must be literally false; a spec that tries to enable it is invalid.
  if (p['inventFacts'] !== false) {
    issues.push(issue('policies.inventFacts', 'INVENT_FACTS_FORBIDDEN', 'policies.inventFacts must be false (invariant I5) — it is not a toggle'));
  }
  const enumChecks: Array<[string, string[]]> = [
    ['missingRequired', ['ask', 'fail', 'blank']],
    ['missingOptional', ['blank', 'omit_section']],
    ['citations', ['off', 'preferred', 'required']],
    ['pii', ['allow', 'vault', 'refuse_export']],
    ['overwrite', ['fail', 'version', 'replace']],
    ['partialBatch', ['allow', 'fail_job']],
  ];
  for (const [key, allowed] of enumChecks) {
    if (!allowed.includes(p[key] as string)) {
      issues.push(issue(`policies.${key}`, 'POLICY_INVALID', `policies.${key} must be one of: ${allowed.join(', ')}`));
    }
  }
  for (const key of ['maxInstances', 'batchWarningThreshold', 'dryRunCount']) {
    if (p[key] !== undefined && (typeof p[key] !== 'number' || (p[key] as number) < 1)) {
      issues.push(issue(`policies.${key}`, 'POLICY_INVALID', `policies.${key} must be a positive number when set`));
    }
  }
}

function validateStep(step: JobStep, index: number, issues: SpecValidationIssue[]): void {
  const at = `steps[${index}]`;
  if (!step || typeof step !== 'object' || !STEP_OPS.includes(step.op)) {
    issues.push(issue(at, 'STEP_INVALID', `step.op must be one of: ${STEP_OPS.join(', ')}`));
    return;
  }
  switch (step.op) {
    case 'analyze':
      if (!step.masterId) issues.push(issue(`${at}.masterId`, 'STEP_INVALID', 'analyze requires masterId'));
      break;
    case 'select_evidence':
      if (!step.selector) issues.push(issue(`${at}.selector`, 'STEP_INVALID', 'select_evidence requires selector'));
      if (!step.as) issues.push(issue(`${at}.as`, 'STEP_INVALID', 'select_evidence requires an output name (as)'));
      break;
    case 'extract_facts':
      if (!step.from) issues.push(issue(`${at}.from`, 'STEP_INVALID', 'extract_facts requires from'));
      if (!step.as) issues.push(issue(`${at}.as`, 'STEP_INVALID', 'extract_facts requires as'));
      break;
    case 'map_schema':
      if (!step.from) issues.push(issue(`${at}.from`, 'STEP_INVALID', 'map_schema requires from'));
      if (step.to !== 'variables' && step.to !== 'sections') {
        issues.push(issue(`${at}.to`, 'STEP_INVALID', "map_schema.to must be 'variables' or 'sections'"));
      }
      break;
    case 'interview':
      if (step.schema !== 'variables' && step.schema !== 'sections') {
        issues.push(issue(`${at}.schema`, 'STEP_INVALID', "interview.schema must be 'variables' or 'sections'"));
      }
      break;
    case 'derive':
      if (!Array.isArray(step.rules) || step.rules.length === 0) {
        issues.push(issue(`${at}.rules`, 'STEP_INVALID', 'derive requires at least one rule'));
      }
      break;
    case 'plan_instances':
      if (step.cardinality !== '1' && step.cardinality !== 'N') {
        issues.push(issue(`${at}.cardinality`, 'STEP_INVALID', "plan_instances.cardinality must be '1' or 'N'"));
      }
      if (typeof step.naming !== 'string' || step.naming.length === 0) {
        issues.push(issue(`${at}.naming`, 'STEP_INVALID', 'plan_instances requires a naming template'));
      }
      break;
    case 'compose':
      if (!COMPOSE_STYLES.includes(step.style)) {
        issues.push(issue(`${at}.style`, 'STEP_INVALID', `compose.style must be one of: ${COMPOSE_STYLES.join(', ')}`));
      }
      if (step.style === 'transform' && !TRANSFORM_OPS.includes(step.transformOp as TransformOp)) {
        issues.push(issue(`${at}.transformOp`, 'STEP_INVALID', `compose(style=transform) requires transformOp: ${TRANSFORM_OPS.join(', ')}`));
      }
      if (step.style !== 'transform' && step.transformOp !== undefined) {
        issues.push(issue(`${at}.transformOp`, 'STEP_INVALID', 'transformOp is only valid when style=transform'));
      }
      break;
    case 'validate':
      if (!Array.isArray(step.checks) || step.checks.length === 0) {
        issues.push(issue(`${at}.checks`, 'STEP_INVALID', 'validate requires at least one check'));
      }
      break;
    case 'review_gate':
      if (!['mapping', 'dry_run', 'section', 'final'].includes(step.gate)) {
        issues.push(issue(`${at}.gate`, 'STEP_INVALID', 'review_gate.gate must be mapping|dry_run|section|final'));
      }
      break;
    case 'deliver':
      if (!step.target || typeof step.target !== 'object' || !('kind' in step.target)) {
        issues.push(issue(`${at}.target`, 'STEP_INVALID', 'deliver requires a target'));
      }
      break;
  }
}

/**
 * Validate a JobSpec. Returns all issues (does not stop at the first).
 * A spec with any issues must never be persisted as `compiled` or run (I1/I12).
 */
export function validateJobSpec(spec: unknown): SpecValidationResult {
  const issues: SpecValidationIssue[] = [];
  if (!spec || typeof spec !== 'object') {
    return { ok: false, issues: [issue('', 'SPEC_INVALID', 'JobSpec must be an object')] };
  }
  const s = spec as Partial<JobSpec> & Record<string, unknown>;

  if (s.version !== JOB_SPEC_VERSION) {
    issues.push(issue('version', 'VERSION_UNSUPPORTED', `JobSpec.version must be ${JOB_SPEC_VERSION}`));
  }
  if (typeof s.intent !== 'string' || s.intent.trim().length === 0) {
    issues.push(issue('intent', 'INTENT_REQUIRED', 'JobSpec.intent must be a non-empty string'));
  }
  if (!Array.isArray(s.inputs)) {
    issues.push(issue('inputs', 'INPUTS_INVALID', 'JobSpec.inputs must be an array'));
  }
  if (!Array.isArray(s.steps) || s.steps.length === 0) {
    issues.push(issue('steps', 'STEPS_REQUIRED', 'JobSpec.steps must be a non-empty array'));
  } else {
    s.steps.forEach((step, i) => validateStep(step as JobStep, i, issues));

    // Structural rules for the v1 linear DAG:
    const stepOps = (s.steps as JobStep[]).map((st) => st?.op);
    const deliverIdx = stepOps.indexOf('deliver');
    const composeIdx = stepOps.indexOf('compose');
    // I1 — artifacts are produced only by Compose→Deliver: deliver without compose is invalid.
    if (deliverIdx !== -1 && composeIdx === -1) {
      issues.push(issue('steps', 'DELIVER_WITHOUT_COMPOSE', 'deliver requires a compose step before it (invariant I1)'));
    }
    if (deliverIdx !== -1 && composeIdx > deliverIdx) {
      issues.push(issue('steps', 'DELIVER_BEFORE_COMPOSE', 'deliver must come after compose (invariant I1)'));
    }
  }
  validatePolicies(s.policies, issues);

  return { ok: issues.length === 0, issues };
}
