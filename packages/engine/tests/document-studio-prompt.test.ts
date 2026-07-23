import { describe, expect, it } from 'vitest';
import { createDocumentStudioSection, DOCUMENT_STUDIO_PROMPT } from '../src/agent/document-studio-prompts.js';

describe('Document Studio agent system prompt', () => {
  it('exports the rules string', () => {
    expect(DOCUMENT_STUDIO_PROMPT).toContain('[DOCUMENT_STUDIO]');
  });

  it('section factory returns the same rules string', () => {
    const section = createDocumentStudioSection();
    expect(section.load()).toBe(DOCUMENT_STUDIO_PROMPT);
    expect(section.render(DOCUMENT_STUDIO_PROMPT)).toBe(DOCUMENT_STUDIO_PROMPT);
  });

  it('contains core invariants', () => {
    const rules = DOCUMENT_STUDIO_PROMPT;
    expect(rules).toContain('Provenance');
    expect(rules).toContain('PII');
    expect(rules).toContain('overwrite');
    expect(rules).toContain('Missing facts');
    expect(rules).toContain('Citations');
  });

  it('contains recommended doc tool ordering', () => {
    const rules = DOCUMENT_STUDIO_PROMPT;
    expect(rules).toContain('doc_master_');
    expect(rules).toContain('doc_binder_');
    expect(rules).toContain('doc_mapping_');
    expect(rules).toContain('doc_answer_set_');
    expect(rules).toContain('doc_job_compile');
    expect(rules).toContain('doc_job_run');
    expect(rules).toContain('doc_job_answer');
    expect(rules).toContain('doc_job_confirm');
    expect(rules).toContain('doc_artifact_');
  });

  it('contains resolution syntax for masters, binders, datasets, kb and jobs', () => {
    const rules = DOCUMENT_STUDIO_PROMPT;
    expect(rules).toContain('@master[');
    expect(rules).toContain('@binder[');
    expect(rules).toContain('@dataset[');
    expect(rules).toContain('@kb[');
    expect(rules).toContain('@job[');
  });

  it('warns about deprecated template tools and mentions safety gates', () => {
    const rules = DOCUMENT_STUDIO_PROMPT;
    expect(rules).toContain('template_');
    expect(rules).toContain('deprecated');
    expect(rules).toContain('validate');
    expect(rules).toContain('dry_run');
  });

  it('instructs the agent to communicate in plain, jargon-free language', () => {
    const rules = DOCUMENT_STUDIO_PROMPT;
    expect(rules).toContain('plain, jargon-free language');
    expect(rules).toContain('What would you like to produce?');
    expect(rules).toContain('confirm before running');
  });
});
