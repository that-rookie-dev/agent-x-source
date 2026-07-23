/**
 * Document Studio — Natural-language → JobSpec classifier/compiler.
 *
 * Maps free-text user intent into a draft JobSpec by choosing a recipe
 * pattern, extracting @-mentions, and reporting missing/ambiguous slots.
 */

import { defaultJobPolicies } from '../jobspec.js';
import { JOB_SPEC_VERSION, type ComposeStyle, type JobInputRef, type JobSpec, type MasterKind } from '../types.js';
import {
  parseMasterMentionIds,
  parseBinderMentionIds,
  parseDatasetMentionIds,
  parseKbMentionIds,
  parseJobMentionIds,
} from '../../agent/TurnJourney.js';

export interface NlCompileResult {
  spec: JobSpec;
  missing: string[];
  ambiguous: string[];
}

export class NlCompiler {
  compile(intent: string, availableMentions?: JobInputRef[]): NlCompileResult {
    const parsed = this.parseMentions(intent);
    const refs = this.mergeRefs(availableMentions ?? [], parsed);
    const lower = intent.toLowerCase();
    const missing: string[] = [];
    const ambiguous: string[] = [];

    let spec: JobSpec;

    if (this.matchesAny(lower, ['fill template', 'mail merge'])) {
      const hasDataset = refs.some((r) => r.type === 'mapping');
      if (hasDataset) {
        spec = this.buildBatchFill(intent, refs);
        missing.push(...this.findMissing(refs, ['layout_master', 'data_master', 'mapping']));
      } else {
        spec = this.buildInteractiveFill(intent, refs);
        missing.push(...this.findMissing(refs, ['layout_master']));
      }
    } else if (this.matchesAny(lower, ['author', 'draft', 'write'])) {
      spec = this.buildAuthor(intent, refs);
      missing.push(...this.findMissing(refs, ['standard_master']));
    } else if (this.matchesAny(lower, ['validate', 'check'])) {
      spec = this.buildValidate(intent, refs);
      missing.push(...this.findMissing(refs, ['target']));
    } else if (this.matchesAny(lower, ['merge documents', 'combine', 'merge'])) {
      spec = this.buildMerge(intent, refs);
      const masterCount = refs.filter((r) => r.type === 'master').length;
      if (masterCount < 2) missing.push('second_master');
    } else if (this.matchesAny(lower, ['render', 'export to html', 'html'])) {
      spec = this.buildRender(intent, refs, lower);
      missing.push(...this.findMissing(refs, ['layout_master']));
    } else if (this.matchesAny(lower, [
      'replicate', 'exact copy', 'clone', 'same design',
      'same layout', 'copy with new', 'copy with updated',
      'duplicate with', 'make a copy', 'recreate',
    ])) {
      // General replicate intent: clone a filled document's design and replace
      // cell values. Values may come from direct user input (doc_job_answer) or
      // derive formulas (e.g. forecasts, price updates, corrections). The derive
      // step is optional — only included if the user/agent supplies formulas.
      spec = this.buildReplicate(intent, refs);
      missing.push(...this.findMissing(refs, ['layout_master']));
    } else {
      ambiguous.push('intent');
      spec = this.buildValidate(intent, refs);
      missing.push('intent');
    }

    return { spec, missing, ambiguous };
  }

  parseMentions(intent: string): JobInputRef[] {
    const refs: JobInputRef[] = [];
    for (const { masterId, role } of parseMasterMentionIds(intent)) {
      refs.push({ type: 'master', masterId, role: role as MasterKind });
    }
    for (const binderId of parseBinderMentionIds(intent)) {
      refs.push({ type: 'binder', binderId });
    }
    for (const mappingId of parseDatasetMentionIds(intent)) {
      refs.push({ type: 'mapping', mappingId });
    }
    for (const answerSetId of parseJobMentionIds(intent)) {
      refs.push({ type: 'answer_set', answerSetId });
    }
    const kbIds = parseKbMentionIds(intent);
    if (kbIds.length > 0) {
      refs.push({ type: 'kb', selector: { mode: 'ids', sourceIds: kbIds } });
    }
    return refs;
  }

  private mergeRefs(a: JobInputRef[], b: JobInputRef[]): JobInputRef[] {
    const seen = new Set<string>();
    const out: JobInputRef[] = [];
    for (const ref of [...a, ...b]) {
      const key = JSON.stringify(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
    return out;
  }

  private matchesAny(text: string, phrases: string[]): boolean {
    for (const phrase of phrases) {
      const words = phrase.split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      if (words.every((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))) {
        return true;
      }
    }
    return false;
  }

  private findMissing(refs: JobInputRef[], slots: string[]): string[] {
    const missing: string[] = [];
    for (const slot of slots) {
      if (this.hasSlot(refs, slot)) continue;
      missing.push(slot);
    }
    return missing;
  }

  private hasSlot(refs: JobInputRef[], slot: string): boolean {
    switch (slot) {
      case 'layout_master':
        return refs.some((r) => r.type === 'master' && r.role === 'layout');
      case 'data_master':
        return refs.some((r) => r.type === 'master' && r.role === 'data');
      case 'standard_master':
        return refs.some((r) => r.type === 'master' && r.role === 'standard');
      case 'mapping':
        return refs.some((r) => r.type === 'mapping');
      case 'target':
        return refs.some((r) => r.type === 'master');
      default:
        return false;
    }
  }

  private placeholder(kind: string): string {
    return `__awaiting_${kind}__`;
  }

  private masterRef(
    refs: JobInputRef[],
    role: MasterKind,
  ): { type: 'master'; masterId: string; role: MasterKind } | undefined {
    return refs.find((r): r is { type: 'master'; masterId: string; role: MasterKind } => r.type === 'master' && r.role === role);
  }

  private mappingRef(refs: JobInputRef[]): { type: 'mapping'; mappingId: string } | undefined {
    return refs.find((r): r is { type: 'mapping'; mappingId: string } => r.type === 'mapping');
  }

  private baseSpec(intent: string, refs: JobInputRef[]): JobSpec {
    return {
      version: JOB_SPEC_VERSION,
      intent,
      inputs: refs,
      steps: [],
      policies: defaultJobPolicies(),
    };
  }

  private buildInteractiveFill(intent: string, refs: JobInputRef[]): JobSpec {
    const layout = this.masterRef(refs, 'layout');
    const spec = this.baseSpec(intent, refs);
    spec.steps = [
      { op: 'analyze', masterId: layout?.masterId ?? this.placeholder('layout_master') },
      { op: 'interview', schema: 'variables', only: 'unresolved_required' },
      { op: 'compose', style: 'fill_clone' },
      { op: 'deliver', target: { kind: 'single', path: 'out/fill.pdf' } },
    ];
    return spec;
  }

  private buildBatchFill(intent: string, refs: JobInputRef[]): JobSpec {
    const layout = this.masterRef(refs, 'layout');
    const data = this.masterRef(refs, 'data');
    const mapping = this.mappingRef(refs);
    const spec = this.baseSpec(intent, refs);
    spec.steps = [
      { op: 'analyze', masterId: layout?.masterId ?? this.placeholder('layout_master') },
      {
        op: 'map_schema',
        from: data?.masterId ?? mapping?.mappingId ?? this.placeholder('data_master'),
        to: 'variables',
        mappingId: mapping?.mappingId,
      },
      { op: 'plan_instances', cardinality: 'N', naming: '{{index}}' },
      { op: 'compose', style: 'fill_clone' },
      { op: 'deliver', target: { kind: 'tree', base: 'out', naming: '{{index}}' } },
    ];
    return spec;
  }

  private buildAuthor(intent: string, refs: JobInputRef[]): JobSpec {
    const standard = this.masterRef(refs, 'standard');
    const spec = this.baseSpec(intent, refs);
    spec.steps = [
      { op: 'extract_facts', from: standard?.masterId ?? this.placeholder('standard_master'), as: 'facts' },
      { op: 'select_evidence', selector: { mode: 'query', text: intent }, as: 'evidence' },
      { op: 'compose', style: 'author' },
      { op: 'validate', checks: [{ kind: 'schema' }] },
      { op: 'deliver', target: { kind: 'single', path: 'out/author.pdf' } },
    ];
    return spec;
  }

  private buildValidate(intent: string, _refs: JobInputRef[]): JobSpec {
    const spec = this.baseSpec(intent, _refs);
    spec.steps = [{ op: 'validate', checks: [{ kind: 'schema' }] }];
    return spec;
  }

  private buildMerge(intent: string, refs: JobInputRef[]): JobSpec {
    const spec = this.baseSpec(intent, refs);
    spec.steps = [
      { op: 'compose', style: 'merge_pack' },
      { op: 'deliver', target: { kind: 'single', path: 'out/merge.pdf' } },
    ];
    return spec;
  }

  private buildRender(intent: string, refs: JobInputRef[], lower: string): JobSpec {
    let style: ComposeStyle = 'html';
    if (lower.includes('markdown')) style = 'markdown';
    else if (lower.includes('json')) style = 'json';
    else if (lower.includes('yaml')) style = 'yaml';
    else if (lower.includes('diagram') || lower.includes('mermaid') || lower.includes('graphviz')) style = 'diagram';
    else if (lower.includes('latex') || lower.includes('tex')) style = 'latex';

    const spec = this.baseSpec(intent, refs);
    spec.steps = [
      { op: 'compose', style },
      { op: 'deliver', target: { kind: 'single', path: `out/render.${style}` } },
    ];
    return spec;
  }

  /**
   * Replicate: clone a filled layout master's design exactly and replace cell
   * values with new values. The derive step is OPTIONAL — it's only useful when
   * the user wants computed values (forecasts, price updates, corrections via
   * formulas). If the user provides values directly via doc_job_answer, the
   * derive step is a no-op pass-through.
   *
   * Chains: analyze (extracts grid-cell pdf_region locators + prior sampleValues)
   * → derive? (optional: applies formulas referencing prior values)
   * → compose:fill_clone (overlays new values at exact cell coordinates)
   * → review_gate:dry_run → deliver.
   *
   * This is the ONLY path for "replicate / exact copy / clone" intent. Free-form
   * authoring (compose:author) must NOT be used — it rebuilds the document from
   * scratch and loses the original layout. The anti-fallback guard enforces this.
   */
  private buildReplicate(intent: string, refs: JobInputRef[]): JobSpec {
    const layout = this.masterRef(refs, 'layout') ?? this.masterRef(refs, 'data') ?? refs.find((r) => r.type === 'master');
    const spec = this.baseSpec(intent, refs);
    spec.steps = [
      { op: 'analyze', masterId: layout?.masterId ?? this.placeholder('layout_master') },
      // Derive is optional. The agent may supply derive rules via doc_job_compile
      // (derived_rules parameter) or the user may provide values directly via
      // doc_job_answer. If no rules are supplied, the derive step is a no-op
      // pass-through (primitiveDerive with a placeholder rule produces no
      // derivedValues, and fill_clone uses the answer values as-is).
      { op: 'derive', rules: [{ key: '__placeholder__', formula: '', description: 'Optional: supply derive rules for computed values (forecasts, updates). Remove this rule if providing values directly via doc_job_answer.' }] },
      { op: 'compose', style: 'fill_clone' },
      { op: 'review_gate', gate: 'dry_run' },
      { op: 'deliver', target: { kind: 'single', path: 'out/replicate.pdf' } },
    ];
    return spec;
  }
}
