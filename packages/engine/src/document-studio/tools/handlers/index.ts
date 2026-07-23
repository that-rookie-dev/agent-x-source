/**
 * Document Studio — tool handlers (spec §9.7.9).
 *
 * Phase 0: every handler passes the service-readiness guard and then returns
 * a structured NOT_IMPLEMENTED with its target phase, so agents can discover
 * the tool surface early without false capability claims (I4 honesty applies
 * to the module itself, not just analysis).
 *
 * Handlers are replaced with real implementations per phase:
 *   material tools → Phase 1–2, job lifecycle → Phase 3–6, outputs → Phase 3+.
 */

import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { docMasterAnalyze, docMasterGet, docMasterList, docMasterUpload } from './masters.js';
import { docBinderCreate, docBinderGet, docBinderList, docBinderUpdate, docKbSelect } from './binders.js';
import { docArtifactList, docJobAnswer, docJobCancel, docJobCompile, docJobCreate, docJobGet, docJobList, docJobRun, docOpenPath } from './jobs.js';
import { docDryRun, docJobConfirm, docManifestGet, docMappingPropose, docMappingSet } from './batch.js';
import { docRecipeGet, docRecipeList } from './recipes.js';

export type DocToolHandler = (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolResult>;

/** Handler per catalog id. Keys MUST cover DOC_STUDIO_TOOL_CATALOG exactly (I13). */
export const DOC_STUDIO_TOOL_HANDLERS: Record<string, DocToolHandler> = {
  // material — Phase 1–2
  doc_binder_list: docBinderList,
  doc_binder_get: docBinderGet,
  doc_binder_create: docBinderCreate,
  doc_binder_update: docBinderUpdate,
  doc_master_list: docMasterList,
  doc_master_get: docMasterGet,
  doc_master_upload: docMasterUpload,
  doc_master_analyze: docMasterAnalyze,
  doc_kb_select: docKbSelect,

  // job lifecycle — Phase 3–6
  doc_recipe_list: docRecipeList,
  doc_recipe_get: docRecipeGet,
  doc_job_compile: docJobCompile,
  doc_job_create: docJobCreate,
  doc_job_get: docJobGet,
  doc_job_list: docJobList,
  doc_job_run: docJobRun,
  doc_job_cancel: docJobCancel,
  doc_job_answer: docJobAnswer,
  doc_job_confirm: docJobConfirm,
  doc_mapping_propose: docMappingPropose,
  doc_mapping_set: docMappingSet,
  doc_dry_run: docDryRun,

  // outputs — Phase 3+
  doc_artifact_list: docArtifactList,
  doc_manifest_get: docManifestGet,
  doc_open_path: docOpenPath,
};
