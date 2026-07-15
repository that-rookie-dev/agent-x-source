import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { generateId, getLogger } from '@agentx/shared';

export interface RecipeStep {
  description: string;
  command?: string;
  tool?: string;
  args?: Record<string, unknown>;
  expectedOutput?: string;
  recipe?: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: RecipeStep[];
  tags?: string[];
  requires?: string[];
}

export class RecipeEngine {
  private recipes: Map<string, Recipe> = new Map();
  private directories: string[] = [];
  private maxRecursionDepth = 5;

  constructor(recipeDirs?: string[]) {
    if (recipeDirs) {
      for (const dir of recipeDirs) {
        this.addDirectory(dir);
      }
    }
  }

  addDirectory(dir: string): void {
    const abs = resolve(dir);
    if (!this.directories.includes(abs)) {
      this.directories.push(abs);
    }
    this.loadFromDirectory(abs);
  }

  private loadFromDirectory(dir: string): void {
    if (!existsSync(dir)) return;
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml'));
      for (const file of files) {
        try {
          const content = readFileSync(join(dir, file), 'utf-8');
          const recipe = JSON.parse(content) as Recipe;
          recipe.id = recipe.id || generateId();
          this.recipes.set(recipe.name, recipe);
        } catch {
          // Skip invalid recipe files
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  registerRecipe(recipe: Recipe): void {
    recipe.id = recipe.id || generateId();
    this.recipes.set(recipe.name, recipe);
  }

  getRecipe(name: string): Recipe | undefined {
    const exact = this.recipes.get(name);
    if (exact) return exact;

    for (const [key, recipe] of this.recipes) {
      if (key.toLowerCase() === name.toLowerCase()) return recipe;
    }
    return undefined;
  }

  listRecipes(tag?: string): Recipe[] {
    const all = Array.from(this.recipes.values());
    if (tag) {
      return all.filter((r) => r.tags?.includes(tag));
    }
    return all;
  }

  async executeRecipe(name: string, executor: (step: RecipeStep) => Promise<string>, depth = 0): Promise<{ success: boolean; steps: Array<{ step: RecipeStep; output: string }> }> {
    if (depth > this.maxRecursionDepth) {
      return { success: false, steps: [{ step: { description: `Max recursion depth (${this.maxRecursionDepth}) exceeded` }, output: 'ERROR: Max recursion depth' }] };
    }

    const recipe = this.getRecipe(name);
    if (!recipe) {
      return { success: false, steps: [] };
    }

    const results: Array<{ step: RecipeStep; output: string }> = [];

    for (const step of recipe.steps) {
      if (step.recipe) {
        const subResult = await this.executeRecipe(step.recipe, executor, depth + 1);
        results.push({ step, output: subResult.success ? `Sub-recipe "${step.recipe}" completed (${subResult.steps.length} steps)` : `Sub-recipe "${step.recipe}" failed` });
        if (!subResult.success) {
          return { success: false, steps: results };
        }
      } else {
        try {
          const output = await executor(step);
          results.push({ step, output });
        } catch (err) {
          results.push({ step, output: `ERROR: ${(err as Error).message}` });
          return { success: false, steps: results };
        }
      }
    }

    return { success: true, steps: results };
  }

  exportRecipe(name: string): Recipe | undefined {
    return this.getRecipe(name);
  }

  importRecipe(data: string | Recipe, filename?: string): Recipe | undefined {
    let recipe: Recipe;
    if (typeof data === 'string') {
      try {
        recipe = JSON.parse(data) as Recipe;
      } catch (error) {
        getLogger().warn('RECIPE_ENGINE', `Failed to parse recipe JSON: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    } else {
      recipe = data;
    }
    if (!recipe.name || !recipe.steps) {
      return undefined;
    }
    recipe.id = recipe.id || generateId();
    this.recipes.set(recipe.name, recipe);

    if (filename && this.directories.length > 0) {
      const dir = this.directories[0]!;
      const filePath = join(dir, filename.endsWith('.json') ? filename : `${filename}.json`);
      const dirPath = dirname(filePath);
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
      writeFileSync(filePath, JSON.stringify(recipe, null, 2), 'utf-8');
    }

    return recipe;
  }
}
