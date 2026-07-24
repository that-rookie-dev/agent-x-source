/**
 * Document Studio — recipe catalog tools (Phase 5/6, spec §5.7).
 */

import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { RECIPE_CATALOG, compileRecipeToSpec } from '../../recipes/catalog.js';

export async function docRecipeList(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const tag = typeof args['tag'] === 'string' ? args['tag'] : undefined;
  const phase = typeof args['phase'] === 'string' ? args['phase'] : undefined;
  const list = RECIPE_CATALOG.filter((r) => (!tag || r.tags.includes(tag)) && (!phase || r.phases.includes(phase)));
  return { success: true, output: list.map((r) => `${r.id}: ${r.name}`).join('\n'), metadata: { recipes: list } };
}

export async function docRecipeGet(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolResult> {
  const id = typeof args['recipeId'] === 'string' ? args['recipeId'] : '';
  const recipe = RECIPE_CATALOG.find((r) => r.id === id);
  if (!recipe) return { success: false, output: `Recipe ${id} not found`, error: 'NOT_FOUND' };
  const spec = compileRecipeToSpec(id);
  return { success: true, output: `${recipe.name}\n${recipe.description}\nSteps: ${recipe.steps.join(' → ')}`, metadata: { recipe, spec } };
}
