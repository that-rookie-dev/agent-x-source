import type { ToolDefinition, ToolCategory, ToolRiskLevel } from '@agentx/shared';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private favoriteTools: Set<string> = new Set();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  listByCategory(category: ToolCategory): ToolDefinition[] {
    return this.list().filter((t) => t.category === category);
  }

  listByRiskLevel(level: ToolRiskLevel): ToolDefinition[] {
    return this.list().filter((t) => t.riskLevel === level);
  }

  filterByEnabled(enabledIds?: string[], disabledIds?: string[]): ToolDefinition[] {
    let tools = this.list();
    if (enabledIds) {
      tools = tools.filter((t) => enabledIds.includes(t.id));
    }
    if (disabledIds) {
      tools = tools.filter((t) => !disabledIds.includes(t.id));
    }
    return tools;
  }

  toSchemas(tools?: ToolDefinition[]): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    const toolList = tools ?? this.list();
    return toolList.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.id,
        description: t.modelDescription,
        parameters: t.schema as unknown as Record<string, unknown>,
      },
    }));
  }

  addFavorite(id: string): void {
    this.favoriteTools.add(id);
  }

  removeFavorite(id: string): void {
    this.favoriteTools.delete(id);
  }

  isFavorite(id: string): boolean {
    return this.favoriteTools.has(id);
  }

  listFavorites(): ToolDefinition[] {
    return [...this.favoriteTools].map((id) => this.tools.get(id)).filter((t): t is ToolDefinition => t !== undefined);
  }

  unregister(id: string): boolean {
    this.favoriteTools.delete(id);
    return this.tools.delete(id);
  }

  unregisterByPrefix(prefix: string): string[] {
    const removed: string[] = [];
    for (const id of [...this.tools.keys()]) {
      if (id.startsWith(prefix)) {
        this.unregister(id);
        removed.push(id);
      }
    }
    return removed;
  }

  listBySource(source: ToolDefinition['source']): ToolDefinition[] {
    return this.list().filter((tool) => tool.source === source);
  }
}
