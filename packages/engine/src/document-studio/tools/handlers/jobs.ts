/**
 * Document Studio — job lifecycle tool handlers (Phase 3, spec §9.2).
 */

import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { validateJobSpec } from '../../jobspec.js';
import { JOB_SPEC_VERSION } from '../../types.js';
import { getDocumentStudioService } from '../../DocumentStudioService.js';
import type { JobInputRef, JobSpec, MasterKind } from '../../types.js';
import {
  parseMasterMentionIds,
  parseBinderMentionIds,
  parseDatasetMentionIds,
  parseKbMentionIds,
  parseJobMentionIds,
} from '../../../agent/TurnJourney.js';
import { NlCompiler } from '../../compiler/NlCompiler.js';

function unavailable(): ToolResult {
  return { success: false, output: 'Document Studio is not available.', error: 'DOC_STUDIO_UNAVAILABLE' };
}

function asJobSpec(raw: unknown): JobSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<JobSpec>;
  if (s.version !== JOB_SPEC_VERSION) return null;
  const validation = validateJobSpec(s);
  return validation.ok ? s as JobSpec : null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function resolveMentionRefs(args: Record<string, unknown>): JobInputRef[] {
  const refs: JobInputRef[] = [];
  const mentions = typeof args['mentions'] === 'string' ? args['mentions'] : '';
  const pinned =
    typeof args['pinned'] === 'object' && args['pinned']
      ? (args['pinned'] as Record<string, unknown>)
      : undefined;

  if (mentions) {
    for (const { masterId, role } of parseMasterMentionIds(mentions)) {
      refs.push({ type: 'master', masterId, role });
    }
    for (const binderId of parseBinderMentionIds(mentions)) {
      refs.push({ type: 'binder', binderId });
    }
    for (const mappingId of parseDatasetMentionIds(mentions)) {
      refs.push({ type: 'mapping', mappingId });
    }
    for (const answerSetId of parseJobMentionIds(mentions)) {
      refs.push({ type: 'answer_set', answerSetId });
    }
    const kbIds = parseKbMentionIds(mentions);
    if (kbIds.length > 0) {
      refs.push({ type: 'kb', selector: { mode: 'ids', sourceIds: kbIds } });
    }
  }

  if (pinned) {
    const masterIds = pinned['masterIds'];
    if (isStringArray(masterIds)) {
      for (const masterId of masterIds) {
        refs.push({ type: 'master', masterId, role: 'layout' as MasterKind });
      }
    }
    const binderId = pinned['binderId'];
    if (typeof binderId === 'string') refs.push({ type: 'binder', binderId });
    const mappingId = pinned['mappingId'];
    if (typeof mappingId === 'string') refs.push({ type: 'mapping', mappingId });
    const answerSetId = pinned['answerSetId'];
    if (typeof answerSetId === 'string') refs.push({ type: 'answer_set', answerSetId });
    const kb = pinned['kb'];
    if (isStringArray(kb)) {
      refs.push({ type: 'kb', selector: { mode: 'ids', sourceIds: kb } });
    }
  }

  return refs;
}

export async function docJobCompile(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const intent = typeof args['intent'] === 'string' ? args['intent'] : '';
  const recipeId = typeof args['recipeId'] === 'string' ? args['recipeId'] : undefined;
  const binderId = typeof args['binderId'] === 'string' ? args['binderId'] : undefined;
  const params = typeof args['params'] === 'object' && args['params'] ? (args['params'] as Record<string, unknown>) : {};
  const spec = asJobSpec(args['spec']);
  try {
    let compiled: { spec: JobSpec; gaps: string[] } | null = null;
    if (spec) {
      const v = validateJobSpec(spec);
      if (!v.ok) {
        return {
          success: false,
          output: `Invalid spec: ${v.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
          error: 'SPEC_INVALID',
        };
      }
      compiled = { spec, gaps: [] };
    } else if (recipeId) {
      compiled = await svc.compileJob({ intent, recipeId, binderId, params });
    } else if (intent) {
      const { spec: nlSpec, missing, ambiguous } = new NlCompiler().compile(intent);
      const v = validateJobSpec(nlSpec);
      if (!v.ok) {
        return {
          success: false,
          output: `Compiled spec invalid: ${v.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
          error: 'COMPILE_FAILED',
        };
      }
      compiled = { spec: nlSpec, gaps: [...missing, ...ambiguous] };
    }
    if (!compiled) return { success: false, output: 'Could not compile JobSpec from provided inputs', error: 'COMPILE_FAILED' };
    const pinnedRefs = resolveMentionRefs(args);
    if (pinnedRefs.length > 0) {
      const existing = new Set(compiled.spec.inputs.map((r) => JSON.stringify(r)));
      for (const ref of pinnedRefs) {
        const key = JSON.stringify(ref);
        if (!existing.has(key)) {
          compiled.spec.inputs.push(ref);
          existing.add(key);
        }
      }
    }
    return { success: true, output: `Compiled draft JobSpec: ${compiled.spec.intent.slice(0, 60)} (${compiled.gaps.length ? `${compiled.gaps.length} gap(s)` : 'no gaps'})`, metadata: { spec: compiled.spec, gaps: compiled.gaps } };
  } catch (err) {
    return { success: false, output: `Compile failed: ${err instanceof Error ? err.message : String(err)}`, error: 'COMPILE_FAILED' };
  }
}

export async function docJobCreate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const title = typeof args['title'] === 'string' ? args['title'] : 'Untitled job';
  const recipeId = typeof args['recipeId'] === 'string' ? args['recipeId'] : undefined;
  const binderId = typeof args['binderId'] === 'string' ? args['binderId'] : undefined;
  const params = typeof args['params'] === 'object' && args['params'] ? (args['params'] as Record<string, unknown>) : {};
  try {
    let job;
    if (recipeId) {
      job = await svc.createJobFromRecipe(title, recipeId, params, binderId);
    } else {
      const spec = asJobSpec(args['spec']);
      if (!spec) return { success: false, output: 'spec must be a valid JobSpec', error: 'SPEC_INVALID' };
      job = await svc.createJob(title, spec, undefined, binderId);
    }
    if (!job) return { success: false, output: 'Could not create job from inputs', error: 'CREATE_FAILED' };
    return { success: true, output: `Job created [id=${job.id}] status=${job.status}`, metadata: { jobId: job.id, status: job.status } };
  } catch (err) {
    return { success: false, output: `Create failed: ${err instanceof Error ? err.message : String(err)}`, error: 'SPEC_INVALID' };
  }
}

export async function docJobGet(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const jobId = typeof args['jobId'] === 'string' ? args['jobId'] : '';
  if (!jobId) return { success: false, output: 'jobId required', error: 'INVALID_ARGS' };
  const job = await svc.getJob(jobId);
  if (!job) return { success: false, output: `Job ${jobId} not found`, error: 'JOB_NOT_FOUND' };
  const block = job.status === 'awaiting_input' ? ` — awaiting input; use doc_job_answer to supply missing values.` : '';
  return { success: true, output: `Job ${job.title} [id=${job.id}] status=${job.status}${block}`, metadata: { jobId: job.id, status: job.status } };
}

export async function docJobList(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const status = typeof args['status'] === 'string' ? args['status'] : undefined;
  const limit = typeof args['limit'] === 'number' ? args['limit'] : 20;
  const jobs = await svc.listJobs({ status, limit });
  return { success: true, output: `${jobs.length} job(s): ${jobs.map((j) => `${j.title} [${j.id}] ${j.status}`).join('; ')}`, metadata: { count: jobs.length, jobIds: jobs.map((j) => j.id) } };
}

export async function docJobRun(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const jobId = typeof args['jobId'] === 'string' ? args['jobId'] : '';
  if (!jobId) return { success: false, output: 'jobId required', error: 'INVALID_ARGS' };
  const job = await svc.getJob(jobId);
  if (!job) return { success: false, output: `Job ${jobId} not found`, error: 'JOB_NOT_FOUND' };
  if (job.status === 'running') return { success: true, output: `Job already running [id=${jobId}]`, metadata: { jobId, status: 'running' } };
  try {
    const updated = await svc.runJob(jobId);
    const status = updated?.status ?? 'failed';
    return {
      success: status === 'completed' || status === 'awaiting_input',
      output: `Job ${jobId} now ${status}${status === 'awaiting_input' ? ' — missing required values' : ''}`,
      error: status === 'failed' ? 'JOB_FAILED' : undefined,
      metadata: { jobId, status },
    };
  } catch (err) {
    return { success: false, output: `Run failed: ${err instanceof Error ? err.message : String(err)}`, error: 'JOB_FAILED', metadata: { jobId } };
  }
}

export async function docJobCancel(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const jobId = typeof args['jobId'] === 'string' ? args['jobId'] : '';
  if (!jobId) return { success: false, output: 'jobId required', error: 'INVALID_ARGS' };
  const job = await svc.cancelJob(jobId);
  if (!job) return { success: false, output: `Job ${jobId} not found`, error: 'JOB_NOT_FOUND' };
  return { success: true, output: `Job ${jobId} cancelled`, metadata: { jobId, status: job.status } };
}

export async function docJobAnswer(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const jobId = typeof args['jobId'] === 'string' ? args['jobId'] : '';
  const answers = typeof args['answers'] === 'object' && args['answers'] ? (args['answers'] as Record<string, unknown>) : undefined;
  if (!jobId || !answers) return { success: false, output: 'jobId and answers required', error: 'INVALID_ARGS' };
  try {
    const updated = await svc.submitAnswers(jobId, answers);
    if (!updated) return { success: false, output: `Job ${jobId} not found`, error: 'JOB_NOT_FOUND' };
    return { success: true, output: `Answers submitted; job ${jobId} now ${updated.status}`, metadata: { jobId, status: updated.status } };
  } catch (err) {
    return { success: false, output: `Submit failed: ${err instanceof Error ? err.message : String(err)}`, error: 'AWAITING_INPUT' };
  }
}

export async function docArtifactList(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const jobId = typeof args['jobId'] === 'string' ? args['jobId'] : '';
  if (!jobId) return { success: false, output: 'jobId required', error: 'INVALID_ARGS' };
  const artifacts = await svc.listArtifacts(jobId);
  return { success: true, output: `${artifacts.length} artifact(s): ${artifacts.map((a) => a.path).join(', ')}`, metadata: { jobId, paths: artifacts.map((a) => a.path) } };
}

export async function docOpenPath(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const path = typeof args['path'] === 'string' ? args['path'] : '';
  if (!path) return { success: false, output: 'path required', error: 'INVALID_ARGS' };
  try {
    const result = await svc.openPath(path);
    return { success: true, output: `Opened ${result.path}`, metadata: { path: result.path } };
  } catch (err) {
    return { success: false, output: `Open failed: ${err instanceof Error ? err.message : String(err)}`, error: 'OPEN_FAILED' };
  }
}
