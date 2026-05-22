import type { ToolDefinition, ToolCategory, ToolRiskLevel } from '@agentx/shared';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

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
}
