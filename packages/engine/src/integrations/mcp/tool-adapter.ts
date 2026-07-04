import type { IntegrationProvider } from '@agentx/shared';
import type { ToolDefinition, ToolParameter } from '@agentx/shared';
import { ParallelMode } from '@agentx/shared';
import { integrationToolId, integrationToolRiskLevel, isReadOnlyIntegrationTool } from '../action-classifier.js';

interface McpToolShape {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

function mapParameterType(type: unknown): string {
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return String(type[0] ?? 'string');
  return 'string';
}

export function adaptMcpTool(
  provider: IntegrationProvider,
  tool: McpToolShape,
): ToolDefinition {
  const properties: Record<string, ToolParameter> = {};
  const schema = tool.inputSchema;
  if (schema?.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      properties[key] = {
        type: mapParameterType(value.type),
        description: typeof value.description === 'string' ? value.description : undefined,
      };
    }
  }

  const readonly = isReadOnlyIntegrationTool(tool.name, provider);
  const riskLevel = integrationToolRiskLevel(tool.name, provider);

  return {
    id: integrationToolId(provider.id, tool.name),
    name: tool.name,
    description: tool.description ?? `${provider.name} integration tool`,
    modelDescription: `[${provider.name}] ${tool.description ?? tool.name}${readonly ? ' (read-only)' : ' (requires user confirmation before execution)'}`,
    category: 'integrations',
    riskLevel,
    schema: {
      type: 'object',
      properties,
      required: Array.isArray(schema?.required) ? schema.required : [],
    },
    composable: true,
    source: 'integration',
    parallelMode: readonly ? ParallelMode.SAFE : ParallelMode.INTEGRATION_CHECK,
    isDestructive: riskLevel === 'critical' || riskLevel === 'high',
  };
}

export function adaptMcpTools(
  provider: IntegrationProvider,
  tools: McpToolShape[],
): ToolDefinition[] {
  return tools.map((tool) => adaptMcpTool(provider, tool));
}
