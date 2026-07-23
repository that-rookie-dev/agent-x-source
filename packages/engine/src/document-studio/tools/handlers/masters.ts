/**
 * Document Studio — master tool handlers (Phase 1, spec §9.1).
 *
 * Output is agent-and-voice friendly: short lines, ids included in metadata
 * for the next tool call (spec §9.7.9).
 */

import { existsSync } from 'node:fs';
import { isPathInsideRoot } from '@agentx/shared';
import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { getDocumentStudioService } from '../../DocumentStudioService.js';
import type { Master, MasterKind } from '../../types.js';

const KINDS: MasterKind[] = ['layout', 'structure', 'standard', 'data', 'prior_artifact'];

function unavailable(): ToolResult {
  return {
    success: false,
    output: 'Document Studio is not available. The module has not been booted in this build.',
    error: 'DOC_STUDIO_UNAVAILABLE',
  };
}

function masterLine(m: Master): string {
  return `${m.name} [id=${m.id}] kind=${m.kind} format=${m.format} analysis=${m.analysisState}${m.analysisError ? ` (${m.analysisError})` : ''}`;
}

export async function docMasterUpload(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const path = typeof args['path'] === 'string' ? args['path'] : '';
  if (!path) return { success: false, output: 'path is required', error: 'INVALID_ARGS' };

  // Validate path is inside workspace scope
  const scopePath = ctx.scopePath ?? process.cwd();
  if (!isPathInsideRoot(path, scopePath)) {
    return { success: false, output: `Path outside workspace scope: ${path}`, error: 'SCOPE_VIOLATION' };
  }
  if (!existsSync(path)) {
    return { success: false, output: `File not found: ${path}`, error: 'FILE_NOT_FOUND' };
  }

  const kind = KINDS.includes(args['kind'] as MasterKind) ? (args['kind'] as MasterKind) : undefined;
  const tags = typeof args['tags'] === 'string'
    ? args['tags'].split(',').map((t) => t.trim()).filter(Boolean)
    : undefined;

  try {
    const master = await svc.uploadMasterFromPath(path, { kind, tags });
    return {
      success: true,
      output: `Master registered: ${masterLine(master)}\nAnalysis started automatically. Call doc_master_analyze with wait=true to get variables+locators, or doc_master_get to check status.`,
      metadata: { masterId: master.id, kind: master.kind, format: master.format, analysisState: master.analysisState },
    };
  } catch (err) {
    return {
      success: false,
      output: `Failed to upload master: ${err instanceof Error ? err.message : String(err)}`,
      error: 'UPLOAD_FAILED',
    };
  }
}

export async function docMasterList(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const kind = KINDS.includes(args['kind'] as MasterKind) ? (args['kind'] as MasterKind) : undefined;
  const query = typeof args['query'] === 'string' ? args['query'] : undefined;
  const masters = await svc.listMasters({ kind, query });
  if (masters.length === 0) {
    return { success: true, output: 'No masters found. Upload masters in Document Studio or via the API first.' };
  }
  return {
    success: true,
    output: `${masters.length} master(s):\n${masters.map(masterLine).join('\n')}`,
    metadata: { count: masters.length, masterIds: masters.map((m) => m.id) },
  };
}

export async function docMasterGet(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const masterId = typeof args['masterId'] === 'string' ? args['masterId'] : '';
  if (!masterId) return { success: false, output: 'masterId is required', error: 'INVALID_ARGS' };
  const master = await svc.getMaster(masterId);
  if (!master) return { success: false, output: `Master ${masterId} not found`, error: 'MASTER_NOT_FOUND' };

  const lines: string[] = [masterLine(master)];
  const a = master.analysis;
  if (!a) {
    lines.push(
      master.analysisState === 'awaiting_model'
        ? 'Analysis awaiting model — configure an AI provider, then call doc_master_analyze. Do NOT treat this master as ready.'
        : `No analysis yet (state=${master.analysisState}). Call doc_master_analyze.`,
    );
  } else {
    lines.push(`Summary: ${a.summary}`);
    if (a.warnings.length > 0) lines.push(`Warnings: ${a.warnings.join(' | ')}`);
    if (a.variables?.length) {
      lines.push(`Variables (${a.variables.length}):`);
      for (const v of a.variables) {
        lines.push(`  - ${v.key} (${v.datatype}${v.required ? ', required' : ''}) locator=${v.locator ? v.locator.type : 'NONE — not fillable'}${v.sensitivity !== 'none' ? ` sensitivity=${v.sensitivity}` : ''}`);
      }
    }
    if (a.requiredSections?.length) {
      lines.push(`Required sections (${a.requiredSections.length}): ${a.requiredSections.map((s) => s.title).join('; ')}`);
    }
    if (a.constraints?.length) {
      lines.push(`Constraints (${a.constraints.length}): ${a.constraints.map((c) => `[${c.kind}] ${c.description}`).join('; ')}`);
    }
    if (a.dataProfile) {
      lines.push(`Data: ${a.dataProfile.rowCount} rows. Columns: ${a.dataProfile.columns.map((c) => `${c.name}(${c.datatype}${c.nullable ? '?' : ''})`).join(', ')}`);
    }
  }
  return {
    success: true,
    output: lines.join('\n'),
    metadata: { masterId: master.id, kind: master.kind, analysisState: master.analysisState },
  };
}

export async function docMasterAnalyze(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const masterId = typeof args['masterId'] === 'string' ? args['masterId'] : '';
  if (!masterId) return { success: false, output: 'masterId is required', error: 'INVALID_ARGS' };
  const existing = await svc.getMaster(masterId);
  if (!existing) return { success: false, output: `Master ${masterId} not found`, error: 'MASTER_NOT_FOUND' };

  const wait = args['wait'] !== false; // tool callers usually want the result
  if (!wait) {
    void svc.analyzeMaster(masterId);
    return { success: true, output: `Analysis started for ${existing.name}. Check doc_master_get for status.`, metadata: { masterId } };
  }
  const master = await svc.analyzeMaster(masterId);
  if (!master) return { success: false, output: `Master ${masterId} not found`, error: 'MASTER_NOT_FOUND' };
  const ok = master.analysisState === 'ready' || master.analysisState === 'partial';
  return {
    success: ok,
    output: ok
      ? `Analysis ${master.analysisState} for ${master.name}. ${master.analysis?.summary ?? ''}${master.analysis?.warnings.length ? `\nWarnings: ${master.analysis.warnings.join(' | ')}` : ''}`
      : `Analysis state=${master.analysisState}${master.analysisError ? `: ${master.analysisError}` : ''}. This master is NOT ready — do not claim otherwise.`,
    error: ok ? undefined : 'ANALYSIS_NOT_READY',
    metadata: { masterId: master.id, analysisState: master.analysisState },
  };
}
