/**
 * Document Studio — registrar (spec §9.7.2).
 *
 * Rules enforced here:
 *  1. Atomic family register — the whole doc_* family registers together or
 *     not at all (I11, I13). A catalog/definition/handler mismatch throws.
 *  2. Idempotent — registry.register overwrites the same id safely.
 *  3. Teardown iterates explicit catalog ids (NOT unregisterByPrefix('doc_'))
 *     — kept id-based deliberately so an accidental future prefix collision
 *     can never nuke unrelated tools.
 */

import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { ToolExecutor } from '../../tools/ToolExecutor.js';
import { DOC_STUDIO_TOOL_CATALOG, DOC_STUDIO_TOOL_IDS } from './catalog.js';
import { DOC_STUDIO_TOOL_DEFINITIONS } from './definitions.js';
import { DOC_STUDIO_TOOL_HANDLERS } from './handlers/index.js';

export interface DocumentStudioToolsConfig {
  enabled?: boolean; // default true
  disabledIds?: string[]; // surgical disable
  voiceDisabledIds?: string[]; // rare; prefer summarization over disable
  legacyTemplateTools?: 'off' | 'shim' | 'on' | boolean; // cutover switch
}

/** Throws if catalog, definitions, and handlers are not in perfect 1:1:1 sync (I13). */
export function assertDocStudioFamilyComplete(): void {
  const catalogIds = new Set(DOC_STUDIO_TOOL_IDS);
  const definitionIds = new Set(DOC_STUDIO_TOOL_DEFINITIONS.map((d) => d.id));
  const handlerIds = new Set(Object.keys(DOC_STUDIO_TOOL_HANDLERS));

  const problems: string[] = [];
  for (const id of catalogIds) {
    if (!definitionIds.has(id)) problems.push(`catalog id ${id} has no ToolDefinition`);
    if (!handlerIds.has(id)) problems.push(`catalog id ${id} has no handler`);
  }
  for (const id of definitionIds) if (!catalogIds.has(id)) problems.push(`definition ${id} not in catalog`);
  for (const id of handlerIds) if (!catalogIds.has(id)) problems.push(`handler ${id} not in catalog`);
  if (problems.length > 0) {
    throw new Error(`Document Studio tool family incomplete (invariant I13):\n- ${problems.join('\n- ')}`);
  }
}

/**
 * Register the full doc_* family on the registry + executor together.
 * No-ops when config.enabled is false.
 */
export function registerDocumentStudioTools(
  registry: ToolRegistry,
  executor: ToolExecutor,
  config: DocumentStudioToolsConfig = {},
): void {
  if (config.enabled === false) return;
  assertDocStudioFamilyComplete();

  const disabled = new Set<string>([
    ...(config.disabledIds ?? []),
    ...(config.voiceDisabledIds ?? []),
  ]);
  for (const definition of DOC_STUDIO_TOOL_DEFINITIONS) {
    if (disabled.has(definition.id)) continue;
    const handler = DOC_STUDIO_TOOL_HANDLERS[definition.id];
    if (!handler) continue; // unreachable: assertDocStudioFamilyComplete guarantees coverage
    registry.register(definition);
    executor.registerHandler(definition.id, handler);
  }
}

/** Bulk teardown by explicit catalog ids (see header note). */
export function unregisterDocumentStudioTools(registry: ToolRegistry, executor: ToolExecutor): string[] {
  const removed: string[] = [];
  for (const entry of DOC_STUDIO_TOOL_CATALOG) {
    if (registry.unregister(entry.id)) removed.push(entry.id);
  }
  executor.unregisterHandlersByPrefix('doc_');
  return removed;
}
