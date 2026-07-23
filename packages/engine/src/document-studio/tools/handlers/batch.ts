/**
 * Document Studio — batch/gate tools (Phase 4, spec §9.3).
 */

import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { getDocumentStudioService } from '../../DocumentStudioService.js';

function unavailable(): ToolResult {
  return { success: false, output: 'Document Studio is not available.', error: 'DOC_STUDIO_UNAVAILABLE' };
}

export async function docMappingPropose(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const dataMasterId = typeof args['dataMasterId'] === 'string' ? args['dataMasterId'] : '';
  const schemaRef = typeof args['schemaRef'] === 'string' ? args['schemaRef'] : '';
  if (!dataMasterId || !schemaRef) return { success: false, output: 'dataMasterId and schemaRef required', error: 'INVALID_ARGS' };
  try {
    const mapping = await svc.proposeMapping(dataMasterId, schemaRef);
    const mapped = mapping.entries.filter((e) => e.variableKey).length;
    const warningSummary = mapping.validationWarnings?.length ? ` (${mapping.validationWarnings.length} warnings)` : '';
    return {
      success: true,
      output: `Proposed mapping ${mapping.id}: ${mapped}/${mapping.entries.length} columns matched${warningSummary}. Confirm with doc_mapping_set.`,
      metadata: {
        mappingId: mapping.id,
        entries: mapping.entries,
        coercionPreview: mapping.coercionPreview ?? [],
        validationWarnings: mapping.validationWarnings ?? [],
      },
    };
  } catch (err) {
    return { success: false, output: `Propose failed: ${err instanceof Error ? err.message : String(err)}`, error: 'MAP_FAILED' };
  }
}

export async function docMappingSet(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const mappingId = typeof args['mappingId'] === 'string' ? args['mappingId'] : '';
  const entries = Array.isArray(args['entries']) ? args['entries'] : undefined;
  if (!mappingId) return { success: false, output: 'mappingId required', error: 'INVALID_ARGS' };
  try {
    const mapping = await svc.updateMapping(mappingId, { entries: entries as never, confirmed: true });
    if (!mapping) return { success: false, output: `Mapping ${mappingId} not found`, error: 'NOT_FOUND' };
    return { success: true, output: `Mapping ${mappingId} confirmed`, metadata: { mappingId: mapping.id, confirmed: mapping.confirmed } };
  } catch (err) {
    return { success: false, output: `Set failed: ${err instanceof Error ? err.message : String(err)}`, error: 'MAP_FAILED' };
  }
}

export async function docDryRun(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const jobId = typeof args['jobId'] === 'string' ? args['jobId'] : '';
  if (!jobId) return { success: false, output: 'jobId required', error: 'INVALID_ARGS' };
  try {
    const job = await svc.dryRunJob(jobId);
    if (!job) return { success: false, output: `Job ${jobId} not found`, error: 'JOB_NOT_FOUND' };
    return { success: true, output: `Dry-run complete; job ${jobId} status=${job.status}`, metadata: { jobId, status: job.status } };
  } catch (err) {
    return { success: false, output: `Dry-run failed: ${err instanceof Error ? err.message : String(err)}`, error: 'DRY_RUN_FAILED' };
  }
}

export async function docJobConfirm(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const jobId = typeof args['jobId'] === 'string' ? args['jobId'] : '';
  if (!jobId) return { success: false, output: 'jobId required', error: 'INVALID_ARGS' };
  try {
    const job = await svc.confirmJobGate(jobId);
    if (!job) return { success: false, output: `Job ${jobId} not found`, error: 'JOB_NOT_FOUND' };
    if (job.status !== 'compiled') return { success: true, output: `Gate already ${job.status}; no confirmation needed.`, metadata: { jobId, status: job.status } };
    const ran = await svc.runJob(jobId);
    return { success: true, output: `Confirmed and running ${jobId} status=${ran?.status ?? 'failed'}`, metadata: { jobId, status: ran?.status ?? 'failed' } };
  } catch (err) {
    return { success: false, output: `Confirm failed: ${err instanceof Error ? err.message : String(err)}`, error: 'CONFIRM_FAILED' };
  }
}

export async function docManifestGet(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const jobId = typeof args['jobId'] === 'string' ? args['jobId'] : '';
  if (!jobId) return { success: false, output: 'jobId required', error: 'INVALID_ARGS' };
  const manifest = await svc.getManifest(jobId);
  if (!manifest) return { success: false, output: `Job ${jobId} not found`, error: 'JOB_NOT_FOUND' };
  return {
    success: true,
    output: `Manifest for ${jobId}: ${manifest.summary.ok} ok, ${manifest.summary.failed} failed, ${manifest.summary.skipped} skipped.`,
    metadata: manifest as unknown as Record<string, unknown>,
  };
}
