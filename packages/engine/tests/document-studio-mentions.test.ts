/**
 * Document Studio — @master/@binder/@dataset/@kb/@job mention resolution.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  parseMasterMentionIds,
  parseBinderMentionIds,
  parseDatasetMentionIds,
  parseKbMentionIds,
  parseJobMentionIds,
} from '../src/agent/TurnJourney.js';
import { docJobCompile } from '../src/document-studio/tools/handlers/jobs.js';
import { setDocumentStudioService, DocumentStudioService } from '../src/document-studio/DocumentStudioService.js';
import { defaultJobPolicies } from '../src/document-studio/jobspec.js';
import { JOB_SPEC_VERSION, type JobSpec } from '../src/document-studio/types.js';

const ctx = { sessionId: 't', scopePath: process.cwd(), timeout: 5000 } as never;

afterEach(() => setDocumentStudioService(null));

function makeSpec(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    version: JOB_SPEC_VERSION,
    intent: 'Fill the tax form',
    inputs: [],
    steps: [
      { op: 'analyze', masterId: 'm0' },
      { op: 'interview', schema: 'variables', only: 'unresolved_required' },
      { op: 'compose', style: 'fill_clone' },
      { op: 'deliver', target: { kind: 'single', path: 'out/tax-form.pdf' } },
    ],
    policies: defaultJobPolicies(),
    ...overrides,
  };
}

describe('Mention parsers', () => {
  it('parseMasterMentionIds extracts master ids and optional roles', () => {
    const out = parseMasterMentionIds('Use @master[layout:abc, data:def] and @master[ghi]');
    expect(out).toEqual([
      { masterId: 'abc', role: 'layout' },
      { masterId: 'def', role: 'data' },
      { masterId: 'ghi', role: 'layout' },
    ]);
  });

  it('parseBinderMentionIds extracts ids', () => {
    expect(parseBinderMentionIds('Pin @binder[b1]')).toEqual(['b1']);
  });

  it('parseDatasetMentionIds extracts ids', () => {
    expect(parseDatasetMentionIds('Map @dataset[map1, map2]')).toEqual(['map1', 'map2']);
  });

  it('parseJobMentionIds extracts ids', () => {
    expect(parseJobMentionIds('Use @job[j1]')).toEqual(['j1']);
  });

  it('parseKbMentionIds extracts source ids', () => {
    expect(parseKbMentionIds('Read @kb[s1, s2] and @kb[s3]')).toEqual(['s1', 's2', 's3']);
  });
});

describe('doc_job_compile mention resolution', () => {
  it('merges @master/@binder/@dataset/@kb/@job mentions into spec.inputs', async () => {
    setDocumentStudioService(new DocumentStudioService({ pool: {} as never }));
    const result = await docJobCompile(
      {
        spec: makeSpec(),
        mentions: 'Use @master[layout:m1] @binder[b1] @dataset[map1] @job[a1] @kb[s1, s2]',
      },
      ctx,
    );
    expect(result.success).toBe(true);
    const compiled = (result.metadata as { spec: JobSpec }).spec;
    expect(compiled.inputs).toEqual(
      expect.arrayContaining([
        { type: 'master', masterId: 'm1', role: 'layout' },
        { type: 'binder', binderId: 'b1' },
        { type: 'mapping', mappingId: 'map1' },
        { type: 'answer_set', answerSetId: 'a1' },
        { type: 'kb', selector: { mode: 'ids', sourceIds: ['s1', 's2'] } },
      ]),
    );
  });

  it('merges pinned object into spec.inputs', async () => {
    setDocumentStudioService(new DocumentStudioService({ pool: {} as never }));
    const result = await docJobCompile(
      {
        spec: makeSpec({ inputs: [{ type: 'master', masterId: 'm0', role: 'layout' }] }),
        pinned: {
          masterIds: ['m2'],
          binderId: 'b2',
          mappingId: 'map2',
          answerSetId: 'a2',
          kb: ['s3'],
        },
      },
      ctx,
    );
    expect(result.success).toBe(true);
    const compiled = (result.metadata as { spec: JobSpec }).spec;
    expect(compiled.inputs).toContainEqual({ type: 'master', masterId: 'm0', role: 'layout' });
    expect(compiled.inputs).toContainEqual({ type: 'master', masterId: 'm2', role: 'layout' });
    expect(compiled.inputs).toContainEqual({ type: 'binder', binderId: 'b2' });
    expect(compiled.inputs).toContainEqual({ type: 'mapping', mappingId: 'map2' });
    expect(compiled.inputs).toContainEqual({ type: 'answer_set', answerSetId: 'a2' });
    expect(compiled.inputs).toContainEqual({ type: 'kb', selector: { mode: 'ids', sourceIds: ['s3'] } });
  });

  it('deduplicates identical refs', async () => {
    setDocumentStudioService(new DocumentStudioService({ pool: {} as never }));
    const result = await docJobCompile(
      {
        spec: makeSpec({ inputs: [{ type: 'master', masterId: 'm1', role: 'layout' }] }),
        mentions: '@master[m1]',
      },
      ctx,
    );
    expect(result.success).toBe(true);
    const compiled = (result.metadata as { spec: JobSpec }).spec;
    expect(compiled.inputs.filter((r) => r.type === 'master' && r.masterId === 'm1').length).toBe(1);
  });
});
