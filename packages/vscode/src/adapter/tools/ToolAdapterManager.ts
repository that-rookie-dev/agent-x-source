import type * as vscode from 'vscode';
import type { AdapterContext, AdapterCategoryResult, ToolkitRefs } from './types';

import { adaptFilesystem } from './filesystem';
import { adaptShellProcess } from './shell';
import { adaptGitVcs } from './git';
import { adaptCodeIntelligence } from './code';
import { adaptWebNetwork } from './web';
import { adaptPackageManagers } from './packages';
import { adaptSecurityCrypto } from './security';
import { adaptAiMeta } from './ai';
import { adaptScheduler } from './scheduler';
import { adaptAgentOrchestration } from './subagent';
import { adaptDataProcessing } from './data';
import { adaptDocuments } from './documents';
import { adaptContainersInfra } from './containers';
import { adaptDatabase } from './database';
import { adaptGithub } from './github';
import { adaptTesting } from './testing';
import { adaptSystemOs } from './system';
import { adaptMcpIntegration } from './mcp';
import { adaptBrowserAutomation } from './browser';
import { adaptCommunication } from './communication';
import { adaptMediaImage } from './media';

export interface ToolAdaptationReport {
  totalTools: number;
  overridden: string[];
  keptAsIs: string[];
  disabled: string[];
  categories: Record<string, AdapterCategoryResult>;
}

export function adaptToolsForVSCode(
  toolkit: ToolkitRefs,
  workspaceRoot: string,
  extensionContext: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): ToolAdaptationReport {
  const adapterContext: AdapterContext = {
    workspaceRoot,
    extensionContext,
    outputChannel,
  };

  const report: ToolAdaptationReport = {
    totalTools: toolkit.registry.list().length,
    overridden: [],
    keptAsIs: [],
    disabled: [],
    categories: {},
  };

  const adapters: Array<{
    name: string;
    fn: (refs: ToolkitRefs, ctx: AdapterContext) => AdapterCategoryResult;
  }> = [
    { name: 'filesystem', fn: adaptFilesystem },
    { name: 'shell_process', fn: adaptShellProcess },
    { name: 'git_vcs', fn: adaptGitVcs },
    { name: 'code_intelligence', fn: adaptCodeIntelligence },
    { name: 'web_network', fn: adaptWebNetwork },
    { name: 'package_managers', fn: adaptPackageManagers },
    { name: 'security_crypto', fn: adaptSecurityCrypto },
    { name: 'ai_meta', fn: adaptAiMeta },
    { name: 'scheduler', fn: adaptScheduler },
    { name: 'agent_orchestration', fn: adaptAgentOrchestration },
    { name: 'data_processing', fn: adaptDataProcessing },
    { name: 'documents', fn: adaptDocuments },
    { name: 'containers_infra', fn: adaptContainersInfra },
    { name: 'database', fn: adaptDatabase },
    { name: 'github', fn: adaptGithub },
    { name: 'testing', fn: adaptTesting },
    { name: 'system_os', fn: adaptSystemOs },
    { name: 'mcp_integration', fn: adaptMcpIntegration },
    { name: 'browser_automation', fn: adaptBrowserAutomation },
    { name: 'communication', fn: adaptCommunication },
    { name: 'media_image', fn: adaptMediaImage },
  ];

  for (const adapter of adapters) {
    const result = adapter.fn(toolkit, adapterContext);
    report.categories[adapter.name] = result;
    report.overridden.push(...result.overridden);
    report.keptAsIs.push(...result.keptAsIs);
    report.disabled.push(...result.disabled);
  }

  outputChannel.appendLine(
    `[ToolAdapter] Adapted ${report.totalTools} tools: ` +
    `${report.overridden.length} overridden, ` +
    `${report.keptAsIs.length} kept as-is, ` +
    `${report.disabled.length} disabled`,
  );

  return report;
}
