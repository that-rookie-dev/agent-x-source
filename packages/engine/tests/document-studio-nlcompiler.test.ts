/**
 * Document Studio — Natural-language → JobSpec compiler tests.
 */

import { describe, it, expect } from 'vitest';
import { NlCompiler } from '../src/document-studio/compiler/NlCompiler.js';
import { validateJobSpec } from '../src/document-studio/jobspec.js';
import { JOB_SPEC_VERSION, type JobSpec } from '../src/document-studio/types.js';

const compiler = new NlCompiler();

describe('NlCompiler intent classification', () => {
  it('compiles "fill template" to an interactive fill recipe', () => {
    const { spec, missing, ambiguous } = compiler.compile('Fill the template @master[layout:m1]');
    expect(spec.version).toBe(JOB_SPEC_VERSION);
    expect(spec.inputs).toContainEqual({ type: 'master', masterId: 'm1', role: 'layout' });
    expect(spec.steps.map((s) => s.op)).toEqual(['analyze', 'interview', 'compose', 'deliver']);
    expect(spec.steps.find((s) => s.op === 'compose')).toMatchObject({ style: 'fill_clone' });
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(missing).toEqual([]);
    expect(ambiguous).toEqual([]);
  });

  it('compiles "mail merge" with a dataset mention to a batch fill recipe', () => {
    const { spec, missing } = compiler.compile(
      'Mail merge @master[layout:m2] @master[data:dm] @dataset[map1]',
    );
    expect(spec.inputs).toContainEqual({ type: 'master', masterId: 'dm', role: 'data' });
    expect(spec.inputs).toContainEqual({ type: 'mapping', mappingId: 'map1' });
    expect(spec.steps.map((s) => s.op)).toEqual(['analyze', 'map_schema', 'plan_instances', 'compose', 'deliver']);
    expect(spec.steps.find((s) => s.op === 'compose')).toMatchObject({ style: 'fill_clone' });
    expect(spec.steps.find((s) => s.op === 'deliver')).toMatchObject({
      target: { kind: 'tree', base: 'out', naming: '{{index}}' },
    });
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(missing).toEqual([]);
  });

  it('compiles "author" to the standard author recipe', () => {
    const { spec, missing } = compiler.compile('Author the policy from @master[standard:s1]');
    expect(spec.inputs).toContainEqual({ type: 'master', masterId: 's1', role: 'standard' });
    expect(spec.steps.map((s) => s.op)).toEqual(['extract_facts', 'select_evidence', 'compose', 'validate', 'deliver']);
    expect(spec.steps.find((s) => s.op === 'compose')).toMatchObject({ style: 'author' });
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(missing).toEqual([]);
  });

  it('compiles "validate" / "check" to a single validate step', () => {
    const { spec, missing } = compiler.compile('Check the contract @master[layout:m3]');
    expect(spec.steps.map((s) => s.op)).toEqual(['validate']);
    expect(spec.steps[0]).toMatchObject({ op: 'validate', checks: [{ kind: 'schema' }] });
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(missing).toEqual([]);
  });

  it('compiles "merge documents" to a merge_pack spec', () => {
    const { spec, missing } = compiler.compile('Merge documents @master[a] and @master[b]');
    expect(spec.steps.map((s) => s.op)).toEqual(['compose', 'deliver']);
    expect(spec.steps.find((s) => s.op === 'compose')).toMatchObject({ style: 'merge_pack' });
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(missing).toEqual([]);
  });

  it('compiles "render" / "export to html" to an HTML render spec', () => {
    const { spec, missing } = compiler.compile('Render to HTML @master[layout:m4]');
    expect(spec.steps.map((s) => s.op)).toEqual(['compose', 'deliver']);
    expect(spec.steps.find((s) => s.op === 'compose')).toMatchObject({ style: 'html' });
    expect(spec.steps.find((s) => s.op === 'deliver')).toMatchObject({
      target: { kind: 'single', path: 'out/render.html' },
    });
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(missing).toEqual([]);
  });

  it('reports missing required slots when mentions are absent', () => {
    const { spec, missing } = compiler.compile('Fill the template');
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(missing).toContain('layout_master');
  });

  it('reports ambiguous intent for unrecognized phrases', () => {
    const { spec, missing, ambiguous } = compiler.compile('Do something useful');
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(ambiguous).toContain('intent');
    expect(missing).toContain('intent');
  });
});

describe('NlCompiler mention extraction', () => {
  it('extracts @master, @binder, @dataset, @kb, and @job from the intent string', () => {
    const intent =
      'Process @master[layout:m1] @master[data:d1] with @binder[b1] and @dataset[map1] plus @job[a1] and @kb[s1, s2]';
    const refs = compiler.parseMentions(intent);
    expect(refs).toEqual(
      expect.arrayContaining([
        { type: 'master', masterId: 'm1', role: 'layout' },
        { type: 'master', masterId: 'd1', role: 'data' },
        { type: 'binder', binderId: 'b1' },
        { type: 'mapping', mappingId: 'map1' },
        { type: 'answer_set', answerSetId: 'a1' },
        { type: 'kb', selector: { mode: 'ids', sourceIds: ['s1', 's2'] } },
      ]),
    );
  });
});
