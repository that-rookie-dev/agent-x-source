/**
 * Document Studio — binder material tool handlers (Phase 2, spec §9.1).
 */

import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { getDocumentStudioService } from '../../DocumentStudioService.js';
import type { BinderSlot, KbSelector } from '../../types.js';

function unavailable(): ToolResult {
  return { success: false, output: 'Document Studio is not available.', error: 'DOC_STUDIO_UNAVAILABLE' };
}

const SLOTS = ['layout_master', 'structure_master', 'standard_master', 'data_master', 'prior_artifact', 'kb_selector', 'answers', 'mapping', 'recipe', 'delivery'];

function normalizeSlot(raw: unknown): BinderSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const role = typeof s['role'] === 'string' ? s['role'] : '';
  if (!SLOTS.includes(role)) return null;
  if (role.endsWith('_master')) {
    return { role, masterId: typeof s['masterId'] === 'string' ? s['masterId'] : '' } as BinderSlot;
  }
  if (role === 'kb_selector' && s['selector']) {
    return { role, selector: s['selector'] as KbSelector };
  }
  if (role === 'answers' && typeof s['answerSetId'] === 'string') {
    return { role: 'answers', answerSetId: s['answerSetId'] } as BinderSlot;
  }
  if (role === 'mapping' && typeof s['mappingId'] === 'string') {
    return { role: 'mapping', mappingId: s['mappingId'] } as BinderSlot;
  }
  if (role === 'recipe' && typeof s['recipeId'] === 'string') {
    return { role: 'recipe', recipeId: s['recipeId'] } as BinderSlot;
  }
  if (role === 'delivery' && typeof s['deliveryPlanId'] === 'string') {
    return { role: 'delivery', deliveryPlanId: s['deliveryPlanId'] } as BinderSlot;
  }
  return null;
}

function binderLine(b: { id: string; name: string; description?: string; slots: BinderSlot[] }): string {
  return `${b.name} [id=${b.id}] slots=${b.slots.length}${b.description ? ` — ${b.description}` : ''}`;
}

export async function docBinderList(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const query = typeof args['query'] === 'string' ? args['query'] : undefined;
  const binders = await svc.listBinders(query);
  return {
    success: true,
    output: binders.length ? `${binders.length} binder(s):\n${binders.map(binderLine).join('\n')}` : 'No binders found.',
    metadata: { count: binders.length, binderIds: binders.map((b) => b.id) },
  };
}

export async function docBinderGet(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const binderId = typeof args['binderId'] === 'string' ? args['binderId'] : '';
  if (!binderId) return { success: false, output: 'binderId is required', error: 'INVALID_ARGS' };
  const binder = await svc.getBinder(binderId);
  if (!binder) return { success: false, output: `Binder ${binderId} not found`, error: 'BINDER_NOT_FOUND' };
  const lines = [binderLine(binder)];
  if (binder.description) lines.push(`Description: ${binder.description}`);
  if (binder.slots.length) {
    lines.push('Slots:');
    for (const slot of binder.slots) {
      if (slot.role.endsWith('_master')) lines.push(`  ${slot.role}: ${(slot as Record<string, string>)['masterId']}`);
      else if (slot.role === 'kb_selector') lines.push(`  kb_selector: ${JSON.stringify((slot as Record<string, unknown>)['selector'])}`);
      else lines.push(`  ${slot.role}: ${Object.entries(slot as Record<string, unknown>).filter(([k]) => k !== 'role').map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
  }
  return { success: true, output: lines.join('\n'), metadata: { binderId: binder.id, slots: binder.slots } };
}

export async function docBinderCreate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const name = typeof args['name'] === 'string' ? args['name'].trim() : '';
  if (!name) return { success: false, output: 'name is required', error: 'INVALID_ARGS' };
  const description = typeof args['description'] === 'string' ? args['description'] : undefined;
  const rawSlots = Array.isArray(args['slots']) ? args['slots'] : [];
  const slots = rawSlots.map(normalizeSlot).filter((s): s is BinderSlot => s !== null);
  const binder = await svc.createBinder({ name, description, slots });
  return { success: true, output: `Binder "${binder.name}" created [id=${binder.id}] with ${binder.slots.length} slots.`, metadata: { binderId: binder.id } };
}

export async function docBinderUpdate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const binderId = typeof args['binderId'] === 'string' ? args['binderId'] : '';
  if (!binderId) return { success: false, output: 'binderId is required', error: 'INVALID_ARGS' };
  const patch: { name?: string; description?: string; slots?: BinderSlot[] } = {};
  if (typeof args['name'] === 'string') patch.name = args['name'];
  if ('description' in args) patch.description = typeof args['description'] === 'string' ? args['description'] : '';
  if ('slots' in args && Array.isArray(args['slots'])) patch.slots = args['slots'].map(normalizeSlot).filter((s): s is BinderSlot => s !== null);
  const binder = await svc.updateBinder(binderId, patch);
  if (!binder) return { success: false, output: `Binder ${binderId} not found`, error: 'BINDER_NOT_FOUND' };
  return { success: true, output: `Binder updated [id=${binder.id}]`, metadata: { binderId: binder.id } };
}

export async function docKbSelect(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const svc = getDocumentStudioService();
  if (!svc) return unavailable();
  const selector = args['selector'] as KbSelector | undefined;
  if (!selector || typeof selector !== 'object' || !('mode' in selector)) {
    return { success: false, output: 'selector is required (e.g. {mode: "prefix", prefix: "A3_1048_"})', error: 'INVALID_ARGS' };
  }
  const topK = typeof args['topK'] === 'number' ? Math.min(Math.max(1, args['topK']), 20) : 5;
  try {
    const result = await svc.previewKbSelector(selector, topK);
    const lines = result.samples.map((s: unknown, i: number) => {
      const sample = s as { id?: string; sourceName?: string; content?: string };
      return `[${i + 1}] ${sample.sourceName ?? 'source'} ${sample.id ? `id=${sample.id}` : ''}\n${(sample.content ?? '').slice(0, 200)}`;
    });
    return {
      success: true,
      output: `KB selector preview: ${result.count} hit(s)${lines.length ? '\n\n' + lines.join('\n\n') : ''}`,
      metadata: { count: result.count },
    };
  } catch (err) {
    return { success: false, output: `KB preview failed: ${err instanceof Error ? err.message : String(err)}`, error: 'KB_UNAVAILABLE' };
  }
}
