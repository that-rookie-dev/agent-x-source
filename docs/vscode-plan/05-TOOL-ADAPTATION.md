# Phase 5: Tool Adaptation — VS Code-Specific Tool Adapters for All 165+ Tools

> **Status**: ⬜ Not Started
> **Depends on**: Phase 2 (Engine Adapter)
> **Estimated Effort**: 7-10 days
> **Files Created**: `packages/vscode/src/adapter/tools/` (entire directory tree)

---

## Overview

Phase 5 creates VS Code-specific tool adapters for every tool registered by `createDefaultToolkit()`. The engine ships 165+ tools across 21 categories. Each tool has a default handler that assumes a CLI environment (terminal output, `process.cwd()`, `execSync` shell commands). The VS Code extension must override handlers where the default behavior is inappropriate for the extension host, and disable tools that are irrelevant in a VS Code context.

### Strategy Summary

1. **Create the default toolkit** via `createDefaultToolkit(workspaceRoot)` — this registers all 165+ tool definitions and their default handlers.
2. **Override specific handlers** with VS Code API-aware versions using `executor.registerHandler(toolId, newHandler)`.
3. **Disable irrelevant tools** by replacing their handlers with stubs that return a friendly "not available" message.
4. **Keep pure-JS and shell-based tools as-is** when they work correctly in the extension host process.

### Priority Classification

| Priority | Categories | Count | Action |
|----------|-----------|-------|--------|
| P1 | filesystem, shell_process, git_vcs, code_intelligence, web_network, package_managers, security_crypto, ai_meta, scheduler, agent_orchestration, data_processing | 11 | Full adapter implementation |
| P2 | documents, containers_infra, database, github, testing, system_os, mcp_integration | 7 | Adapter with minor modifications |
| P3 | browser_automation, communication, media_image | 3 | Stub/disable selective tools |

---

## Task Index

| Task ID | Title | Status | Priority |
|---------|-------|--------|----------|
| T5.1 | Tool Adapter Architecture | ⬜ | Core |
| T5.2 | Filesystem Adapter (16 tools) | ⬜ | P1 |
| T5.3 | Shell & Process Adapter (5 tools) | ⬜ | P1 |
| T5.4 | Git & VCS Adapter (13 tools) | ⬜ | P1 |
| T5.5 | Code Intelligence Adapter (13 tools) | ⬜ | P1 |
| T5.6 | Web & Network Adapter (7 tools) | ⬜ | P1 |
| T5.7 | Package Managers Adapter (8 tools) | ⬜ | P1 |
| T5.8 | Security & Crypto Adapter (4 tools) | ⬜ | P1 |
| T5.9 | AI Meta-Tools Adapter (7 tools) | ⬜ | P1 |
| T5.10 | Scheduler Adapter (3 tools) | ⬜ | P1 |
| T5.11 | Agent Orchestration Adapter (3 tools) | ⬜ | P1 |
| T5.12 | Data Processing Adapter (8 tools) | ⬜ | P1 |
| T5.13 | Documents Adapter (15 tools) | ⬜ | P2 |
| T5.14 | Containers & Infra Adapter (9 tools) | ⬜ | P2 |
| T5.15 | Database Adapter (5 tools) | ⬜ | P2 |
| T5.16 | GitHub Adapter (9 tools) | ⬜ | P2 |
| T5.17 | Testing Adapter (5 tools) | ⬜ | P2 |
| T5.18 | System & OS Adapter (12 tools) | ⬜ | P2 |
| T5.19 | Browser Automation Adapter (6 tools) | ⬜ | P3 |
| T5.20 | Communication Adapter (5 tools) | ⬜ | P3 |
| T5.21 | Media & Image Adapter (4 tools) | ⬜ | P3 |
| T5.22 | Verification & Testing | ⬜ | Core |

---

## T5.1: Tool Adapter Architecture

**Status**: ⬜ Not Started
**Files**: `packages/vscode/src/adapter/tools/ToolAdapterManager.ts`, `packages/vscode/src/adapter/tools/types.ts`
**Estimated Effort**: 3 hours

### T5.1.1: Shared Types (`types.ts`)

**File**: `packages/vscode/src/adapter/tools/types.ts`

```typescript
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import type { ToolRegistry } from '@agentx/engine';
import type { ToolExecutor } from '@agentx/engine';
import type * as vscode from 'vscode';

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolResult>;

export interface ToolkitRefs {
  registry: ToolRegistry;
  executor: ToolExecutor;
}

export interface AdapterContext {
  workspaceRoot: string;
  extensionContext: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
}

export interface AdapterCategoryResult {
  overridden: string[];
  keptAsIs: string[];
  disabled: string[];
}

export function createDisabledHandler(
  toolId: string,
  reason: string,
): ToolHandler {
  return async () => ({
    success: false,
    output: `${toolId} is not available in VS Code: ${reason}`,
    error: 'NOT_AVAILABLE_IN_VSCODE',
  });
}

export function createWorkspaceScopedHandler(
  originalHandler: ToolHandler,
  workspaceRoot: string,
): ToolHandler {
  return async (args, context) => {
    const scopedContext: ToolExecutionContext = {
      ...context,
      scopePath: workspaceRoot,
    };
    return originalHandler(args, scopedContext);
  };
}
```

**Acceptance Criteria**:
- `ToolHandler` type matches the engine's handler signature exactly
- `ToolkitRefs` bundles registry + executor for passing to adapter functions
- `AdapterContext` carries VS Code-specific references
- `createDisabledHandler` returns a stub that produces a clear error message
- `createWorkspaceScopedHandler` wraps any handler to force workspace root scope

---

### T5.1.2: Tool Adapter Manager (`ToolAdapterManager.ts`)

**File**: `packages/vscode/src/adapter/tools/ToolAdapterManager.ts`

```typescript
import type * as vscode from 'vscode';
import type { ToolRegistry, ToolExecutor } from '@agentx/engine';
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
```

**Acceptance Criteria**:
- `adaptToolsForVSCode` takes the default toolkit, overrides handlers, and returns a report
- All 21 category adapter functions are invoked in sequence
- Each category returns which tools were overridden, kept, or disabled
- Output channel logs the adaptation summary
- No modification to `@agentx/engine` source code

---

### T5.1.3: Directory Structure

```
packages/vscode/src/adapter/tools/
├── types.ts
├── ToolAdapterManager.ts
├── filesystem.ts
├── shell.ts
├── git.ts
├── code.ts
├── web.ts
├── packages.ts
├── security.ts
├── ai.ts
├── scheduler.ts
├── subagent.ts
├── data.ts
├── documents.ts
├── containers.ts
├── database.ts
├── github.ts
├── testing.ts
├── system.ts
├── mcp.ts
├── browser.ts
├── communication.ts
└── media.ts
```

---

## T5.2: Filesystem Adapter (16 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/filesystem.ts`
**Source**: `packages/engine/src/tools/builtin/filesystem.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `file_read` | `node:fs` readFileSync | `vscode.workspace.fs.readFile` | Override |
| `file_write` | `node:fs` writeFileSync | `vscode.workspace.fs.writeFile` | Override |
| `file_delete` | `node:fs` unlinkSync | `vscode.workspace.fs.delete` | Override |
| `folder_create` | `node:fs` mkdirSync | `vscode.workspace.fs.createDirectory` | Override |
| `folder_delete` | `node:fs` rmSync | `vscode.workspace.fs.delete` (recursive) | Override |
| `folder_list` | `node:fs` readdirSync | `vscode.workspace.fs.readDirectory` | Override |
| `folder_move` | `node:fs` renameSync | `vscode.workspace.fs.rename` | Override |
| `file_copy` | `node:fs` cpSync/copyFileSync | `vscode.workspace.fs.copy` | Override |
| `file_find` | `execSync` find | Keep shell-based (VS Code has no glob API for files) | Keep as-is |
| `file_diff` | `execSync` diff | Keep shell-based | Keep as-is |
| `file_metadata` | `node:fs` statSync | `vscode.workspace.fs.stat` + `node:fs` for extras | Override |
| `file_open` | `execSync` open | `vscode.window.showTextDocument` | Override |
| `folder_tree` | `execSync` find | Keep shell-based | Keep as-is |
| `folder_open` | `execSync` open/finder | `vscode.commands.executeCommand('revealFileInOS')` | Override |
| `archive_create` | `execSync` tar/zip | Keep shell-based | Keep as-is |
| `archive_extract` | `execSync` tar/unzip | Keep shell-based | Keep as-is |

### Implementation

```typescript
import * as vscode from 'vscode';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult, ToolHandler } from './types';

export function adaptFilesystem(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const ws = ctx.workspaceRoot;

  // ── file_read ──
  refs.executor.registerHandler('file_read', async (args, context): Promise<ToolResult> => {
    const filePath = resolve(ws, args['path'] as string);
    try {
      const uri = vscode.Uri.file(filePath);
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString('utf-8');
      const offset = (args['offset'] as number) ?? 0;
      const limit = args['limit'] as number | undefined;

      if (offset > 0 || limit !== undefined) {
        const lines = content.split('\n');
        const start = Math.max(0, offset);
        const end = limit !== undefined ? start + limit : undefined;
        const sliced = lines.slice(start, end);
        return {
          success: true,
          output: sliced.join('\n'),
          metadata: { totalLines: lines.length, returnedLines: sliced.length, offset: start },
        };
      }

      return { success: true, output: content };
    } catch (error) {
      return { success: false, output: `Failed to read file: ${(error as Error).message}`, error: 'READ_ERROR' };
    }
  });
  result.overridden.push('file_read');

  // ── file_write ──
  refs.executor.registerHandler('file_write', async (args, context): Promise<ToolResult> => {
    const filePath = resolve(ws, args['path'] as string);
    const content = args['content'] as string;
    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(filePath)));
      const encoder = new TextEncoder();
      const contentWithNewline = content.endsWith('\n') ? content : content + '\n';
      await vscode.workspace.fs.writeFile(uri, encoder.encode(contentWithNewline));
      return { success: true, output: `Written to ${filePath}` };
    } catch (error) {
      return { success: false, output: `Failed to write file: ${(error as Error).message}`, error: 'WRITE_ERROR' };
    }
  });
  result.overridden.push('file_write');

  // ── file_delete ──
  refs.executor.registerHandler('file_delete', async (args, context): Promise<ToolResult> => {
    const filePath = resolve(ws, args['path'] as string);
    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.workspace.fs.delete(uri, { useTrash: true });
      return { success: true, output: `Deleted ${filePath}` };
    } catch (error) {
      return { success: false, output: `Failed to delete file: ${(error as Error).message}`, error: 'DELETE_ERROR' };
    }
  });
  result.overridden.push('file_delete');

  // ── folder_create ──
  refs.executor.registerHandler('folder_create', async (args, context): Promise<ToolResult> => {
    const dirPath = resolve(ws, args['path'] as string);
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
      return { success: true, output: `Created directory ${dirPath}` };
    } catch (error) {
      return { success: false, output: `Failed to create directory: ${(error as Error).message}`, error: 'MKDIR_ERROR' };
    }
  });
  result.overridden.push('folder_create');

  // ── folder_delete ──
  refs.executor.registerHandler('folder_delete', async (args, context): Promise<ToolResult> => {
    const dirPath = resolve(ws, args['path'] as string);
    try {
      const uri = vscode.Uri.file(dirPath);
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
      return { success: true, output: `Deleted directory ${dirPath}` };
    } catch (error) {
      return { success: false, output: `Failed to delete directory: ${(error as Error).message}`, error: 'RMDIR_ERROR' };
    }
  });
  result.overridden.push('folder_delete');

  // ── folder_list ──
  refs.executor.registerHandler('folder_list', async (args, context): Promise<ToolResult> => {
    const dirPath = resolve(ws, (args['path'] as string) ?? '.');
    try {
      const uri = vscode.Uri.file(dirPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      const details = entries.map(([name, type]) => {
        const prefix = type === vscode.FileType.Directory ? 'd' : 'f';
        return `${prefix} ${name}`;
      });
      return { success: true, output: details.join('\n') };
    } catch (error) {
      return { success: false, output: `Failed to list directory: ${(error as Error).message}`, error: 'LIST_ERROR' };
    }
  });
  result.overridden.push('folder_list');

  // ── folder_move ──
  refs.executor.registerHandler('folder_move', async (args, context): Promise<ToolResult> => {
    const source = resolve(ws, args['from'] as string);
    const destination = resolve(ws, args['to'] as string);
    try {
      const sourceUri = vscode.Uri.file(source);
      const destUri = vscode.Uri.file(destination);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(destination)));
      await vscode.workspace.fs.rename(sourceUri, destUri, { overwrite: false });
      return { success: true, output: `Moved ${source} → ${destination}` };
    } catch (error) {
      return { success: false, output: `Failed to move: ${(error as Error).message}`, error: 'MOVE_ERROR' };
    }
  });
  result.overridden.push('folder_move');

  // ── file_copy ──
  refs.executor.registerHandler('file_copy', async (args, context): Promise<ToolResult> => {
    const from = resolve(ws, args['from'] as string);
    const to = resolve(ws, args['to'] as string);
    try {
      const sourceUri = vscode.Uri.file(from);
      const destUri = vscode.Uri.file(to);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(to)));
      await vscode.workspace.fs.copy(sourceUri, destUri, { overwrite: false });
      return { success: true, output: `Copied ${from} → ${to}` };
    } catch (error) {
      return { success: false, output: `Copy failed: ${(error as Error).message}`, error: 'COPY_ERROR' };
    }
  });
  result.overridden.push('file_copy');

  // ── file_metadata ──
  refs.executor.registerHandler('file_metadata', async (args, context): Promise<ToolResult> => {
    const filePath = resolve(ws, args['path'] as string);
    if (!existsSync(filePath)) {
      return { success: false, output: 'Path does not exist', error: 'NOT_FOUND' };
    }
    try {
      const stat = statSync(filePath);
      const isDir = stat.isDirectory();
      const info = [
        `Path: ${filePath}`,
        `Type: ${isDir ? 'directory' : 'file'}`,
        `Size: ${isDir ? '-' : `${stat.size} bytes`}`,
        `Created: ${stat.birthtime.toISOString()}`,
        `Modified: ${stat.mtime.toISOString()}`,
        `Permissions: ${(stat.mode & 0o777).toString(8)}`,
        `Owner: ${stat.uid}:${stat.gid}`,
      ];
      return { success: true, output: info.join('\n') };
    } catch (error) {
      return { success: false, output: `Failed to read metadata: ${(error as Error).message}`, error: 'STAT_ERROR' };
    }
  });
  result.overridden.push('file_metadata');

  // ── file_open ──
  refs.executor.registerHandler('file_open', async (args, context): Promise<ToolResult> => {
    const filePath = resolve(ws, args['path'] as string);
    if (!existsSync(filePath)) {
      return { success: false, output: 'File does not exist', error: 'NOT_FOUND' };
    }
    try {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true });
      return { success: true, output: `Opened ${filePath} in editor` };
    } catch (error) {
      return { success: false, output: `Failed to open: ${(error as Error).message}`, error: 'OPEN_ERROR' };
    }
  });
  result.overridden.push('file_open');

  // ── folder_open ──
  refs.executor.registerHandler('folder_open', async (args, context): Promise<ToolResult> => {
    const dirPath = resolve(ws, args['path'] as string);
    if (!existsSync(dirPath)) {
      return { success: false, output: 'Directory does not exist', error: 'NOT_FOUND' };
    }
    try {
      const uri = vscode.Uri.file(dirPath);
      await vscode.commands.executeCommand('revealFileInOS', uri);
      return { success: true, output: `Revealed ${dirPath} in file manager` };
    } catch (error) {
      return { success: false, output: `Failed to open directory: ${(error as Error).message}`, error: 'OPEN_ERROR' };
    }
  });
  result.overridden.push('folder_open');

  // ── Kept as-is ──
  result.keptAsIs.push(
    'file_find',
    'file_diff',
    'folder_tree',
    'archive_create',
    'archive_extract',
  );

  return result;
}
```

**VS Code APIs Used**:
- `vscode.workspace.fs.readFile(uri)` — async file read
- `vscode.workspace.fs.writeFile(uri, bytes)` — async file write
- `vscode.workspace.fs.delete(uri, options)` — async delete with trash support
- `vscode.workspace.fs.createDirectory(uri)` — async recursive mkdir
- `vscode.workspace.fs.readDirectory(uri)` — async readdir returning `[name, FileType][]`
- `vscode.workspace.fs.rename(source, target, options)` — async rename
- `vscode.workspace.fs.copy(source, target, options)` — async copy
- `vscode.workspace.openTextDocument(uri)` — open file as text document
- `vscode.window.showTextDocument(doc)` — show in editor
- `vscode.commands.executeCommand('revealFileInOS', uri)` — reveal in Finder/Explorer

**Acceptance Criteria**:
- All 10 overridden tools use `vscode.workspace.fs` API
- `file_delete` and `folder_delete` use `useTrash: true` for safety
- `file_open` opens in VS Code editor instead of external app
- `folder_open` reveals in OS file manager via VS Code command
- 5 tools kept as-is (shell-dependent but work in extension host)

---

## T5.3: Shell & Process Adapter (5 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/shell.ts`
**Source**: `packages/engine/src/tools/builtin/shell.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `shell_exec` | `execSync` | Keep `child_process`, force cwd to workspace root | Override (cwd enforcement) |
| `shell_exec_streaming` | `spawn` | Keep `child_process`, forward output via output channel | Override (output channel integration) |
| `shell_background` | `spawn` detached | Keep as-is (works in extension host) | Keep as-is |
| `process_kill` | `process.kill` | Keep as-is | Keep as-is |
| `process_list` | `execSync` ps | Keep as-is | Keep as-is |

### Implementation

```typescript
import * as vscode from 'vscode';
import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptShellProcess(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const ws = ctx.workspaceRoot;

  // ── shell_exec ──
  refs.executor.registerHandler('shell_exec', async (args, context): Promise<ToolResult> => {
    const command = args['command'] as string;
    const cwd = args['cwd'] ? resolve(ws, args['cwd'] as string) : ws;
    const timeout = Math.min((args['timeout'] as number) ?? 30000, 600000);
    const maxLength = (args['maxLength'] as number) ?? 30000;

    try {
      const output = execSync(command, {
        cwd,
        timeout,
        encoding: 'utf-8',
        shell: '/bin/bash',
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, TERM: 'dumb' },
      });
      const trimmed = output.trim();
      const truncated = trimmed.length > maxLength
        ? trimmed.slice(0, maxLength) + `\n... [output truncated at ${maxLength} chars]`
        : trimmed;
      return { success: true, output: truncated };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message: string; status?: number };
      const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
      const truncated = output.length > maxLength
        ? output.slice(0, maxLength) + `\n... [output truncated at ${maxLength} chars]`
        : output;
      return { success: false, output: truncated, error: 'EXEC_ERROR', metadata: { exitCode: err.status } };
    }
  });
  result.overridden.push('shell_exec');

  // ── shell_exec_streaming ──
  refs.executor.registerHandler('shell_exec_streaming', async (args, context): Promise<ToolResult> => {
    const command = args['command'] as string;
    const cwd = args['cwd'] ? resolve(ws, args['cwd'] as string) : ws;
    const maxLength = (args['maxLength'] as number) ?? 30000;

    return new Promise((resolvePromise) => {
      const child = spawn('/bin/bash', ['-c', command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'dumb' },
      });

      let stdout = '';
      let stderr = '';
      const maxBuffer = 100 * 1024;

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (stdout.length > maxBuffer) stdout = stdout.slice(-maxBuffer);
        ctx.outputChannel.append(chunk);
      });

      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
        ctx.outputChannel.append(chunk);
      });

      child.on('close', (code) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        const truncated = output.length > maxLength
          ? output.slice(0, maxLength) + `\n... [output truncated at ${maxLength} chars]`
          : output;
        resolvePromise({
          success: code === 0,
          output: truncated || `Process exited with code ${code}`,
          metadata: { exitCode: code },
          error: code !== 0 ? 'EXEC_ERROR' : undefined,
        });
      });

      child.on('error', (err) => {
        resolvePromise({ success: false, output: `Failed to start: ${err.message}`, error: 'SPAWN_ERROR' });
      });
    });
  });
  result.overridden.push('shell_exec_streaming');

  // ── Kept as-is ──
  result.keptAsIs.push('shell_background', 'process_kill', 'process_list');

  return result;
}
```

**VS Code APIs Used**:
- `vscode.OutputChannel.append(chunk)` — streaming output to Agent-X output channel

**Acceptance Criteria**:
- `shell_exec` forces `cwd` to workspace root (never VS Code install directory)
- `shell_exec_streaming` forwards real-time output to the VS Code output channel
- `shell_background`, `process_kill`, `process_list` work unchanged in extension host

---

## T5.4: Git & VCS Adapter (13 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/git.ts`
**Source**: `packages/engine/src/tools/builtin/git.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `git_status` | `execSync git status` | Try VS Code Git extension API, fallback to shell | Override |
| `git_diff` | `execSync git diff` | Try VS Code Git extension API, fallback to shell | Override |
| `git_log` | `execSync git log` | Keep shell-based (VS Code Git API doesn't expose log) | Keep as-is |
| `git_commit` | `execSync git commit` | Keep shell-based | Keep as-is |
| `git_add` | `execSync git add` | Keep shell-based | Keep as-is |
| `git_branch` | `execSync git branch` | Keep shell-based | Keep as-is |
| `git_checkout` | `execSync git checkout` | Keep shell-based | Keep as-is |
| `git_stash` | `execSync git stash` | Keep shell-based | Keep as-is |
| `git_blame` | `execSync git blame` | Keep shell-based | Keep as-is |
| `git_show` | `execSync git show` | Keep shell-based | Keep as-is |
| `git_push` | `execSync git push` | Keep shell-based | Keep as-is |
| `git_pull` | `execSync git pull` | Keep shell-based | Keep as-is |
| `git_merge` | `execSync git merge` | Keep shell-based | Keep as-is |

### Implementation

```typescript
import * as vscode from 'vscode';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

interface GitExtensionAPI {
  getAPI(version: number): {
    repositories: Array<{
      rootUri: vscode.Uri;
      state: {
        workingTreeChanges: Array<{ uri: vscode.Uri; status: number }>;
        indexChanges: Array<{ uri: vscode.Uri; status: number }>;
        refs: Array<{ name: string; commit: string; type: number }>;
        HEAD?: { name?: string; commit?: string };
      };
    }>;
  };
}

function getGitExtension(): GitExtensionAPI | null {
  const ext = vscode.extensions.getExtension<GitExtensionAPI>('vscode.git');
  return ext?.isActive ? ext.exports : null;
}

function getRepoForWorkspace(api: ReturnType<GitExtensionAPI['getAPI']>, ws: string) {
  return api.repositories.find(
    (r) => r.rootUri.fsPath === ws || ws.startsWith(r.rootUri.fsPath),
  );
}

const STATUS_MAP: Record<number, string> = {
  0: '  ', 1: 'M ', 2: 'A ', 3: 'D ', 4: 'R ', 5: 'C ', 6: 'U ', 7: '? ',
};

function gitShell(cmd: string, cwd: string): ToolResult {
  try {
    const output = execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { success: true, output: output.trim() || '(no output)' };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
    return { success: false, output, error: 'GIT_ERROR' };
  }
}

export function adaptGitVcs(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const ws = ctx.workspaceRoot;

  // ── git_status ──
  refs.executor.registerHandler('git_status', async (): Promise<ToolResult> => {
    const gitApi = getGitExtension()?.getAPI(1);
    if (gitApi) {
      const repo = getRepoForWorkspace(gitApi, ws);
      if (repo) {
        const lines: string[] = [];
        for (const change of repo.state.indexChanges) {
          const status = STATUS_MAP[change.status] ?? '? ';
          lines.push(`${status}${change.uri.fsPath.replace(ws + '/', '')}`);
        }
        for (const change of repo.state.workingTreeChanges) {
          const status = STATUS_MAP[change.status] ?? '? ';
          lines.push(`${status}${change.uri.fsPath.replace(ws + '/', '')}`);
        }
        const head = repo.state.HEAD;
        const header = head?.name ? `On branch ${head.name}` : `HEAD detached at ${head?.commit?.slice(0, 7) ?? 'unknown'}`;
        return {
          success: true,
          output: lines.length > 0 ? `${header}\n\n${lines.join('\n')}` : `${header}\n\nNothing to commit, working tree clean`,
        };
      }
    }
    return gitShell('status --short', ws);
  });
  result.overridden.push('git_status');

  // ── git_diff ──
  refs.executor.registerHandler('git_diff', async (args): Promise<ToolResult> => {
    const ref = args['ref'] as string | undefined;
    const file = (args['path'] ?? args['file']) as string | undefined;
    let cmd = 'diff';
    if (ref) cmd += ` ${ref}`;
    if (file) cmd += ` -- ${file}`;
    return gitShell(cmd, ws);
  });
  result.overridden.push('git_diff');

  // ── Kept as-is (all use gitShell internally, cwd is scopePath which is workspace root) ──
  result.keptAsIs.push(
    'git_log', 'git_commit', 'git_add', 'git_branch', 'git_checkout',
    'git_stash', 'git_blame', 'git_show', 'git_push', 'git_pull', 'git_merge',
  );

  return result;
}
```

**VS Code APIs Used**:
- `vscode.extensions.getExtension('vscode.git')` — access built-in Git extension API
- `GitExtensionAPI.getAPI(1).repositories` — get repository state
- `repo.state.workingTreeChanges` — working tree change list
- `repo.state.indexChanges` — staged change list
- `repo.state.HEAD` — current branch/commit info

**Acceptance Criteria**:
- `git_status` uses VS Code Git extension API when available, falls back to shell
- `git_diff` uses shell (VS Code Git API doesn't provide diff text)
- All other git tools kept as-is (shell works in extension host, cwd is workspace root)

---

## T5.5: Code Intelligence Adapter (13 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/code.ts`
**Source**: `packages/engine/src/tools/builtin/code.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `code_search` | `execSync` grep/find | Keep shell-based (VS Code search API not available programmatically) | Keep as-is |
| `code_replace` | `node:fs` read+write | Use `vscode.WorkspaceEdit` for undo support | Override |
| `code_insert` | `node:fs` read+write | Use `vscode.WorkspaceEdit` for undo support | Override |
| `code_definitions` | regex parsing | Use `vscode.commands.executeCommand('vscode.executeDefinitionProvider')` | Override |
| `code_symbols` | regex parsing | Use `vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider')` | Override |
| `file_patch` | `node:fs` read+write | Use `vscode.WorkspaceEdit` for atomic multi-edit | Override |
| `code_grep` | `execSync` grep | Keep shell-based | Keep as-is |
| `code_references` | `execSync` grep | Use `vscode.commands.executeCommand('vscode.executeReferenceProvider')` | Override |
| `code_format` | `execSync` prettier | Use `vscode.commands.executeCommand('vscode.executeFormatDocumentProvider')` | Override |
| `code_lint` | `execSync` eslint | Keep shell-based | Keep as-is |
| `code_fix` | `execSync` eslint --fix | Keep shell-based | Keep as-is |
| `code_typecheck` | `execSync` tsc | Keep shell-based | Keep as-is |
| `code_analyze` | regex parsing | Keep as-is (pure JS analysis) | Keep as-is |

### Implementation

```typescript
import * as vscode from 'vscode';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptCodeIntelligence(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const ws = ctx.workspaceRoot;

  // ── code_replace ──
  refs.executor.registerHandler('code_replace', async (args): Promise<ToolResult> => {
    const file = resolve(ws, (args['path'] ?? args['file']) as string);
    const oldStr = (args['search'] ?? args['old']) as string;
    const newStr = (args['replace'] ?? args['new']) as string;

    if (!existsSync(file)) {
      return { success: false, output: 'File not found', error: 'NOT_FOUND' };
    }

    const content = readFileSync(file, 'utf-8');
    const occurrences = content.split(oldStr).length - 1;

    if (occurrences === 0) {
      return { success: false, output: 'Pattern not found in file', error: 'NO_MATCH' };
    }
    if (occurrences > 1) {
      return { success: false, output: `Pattern matches ${occurrences} locations — must be unique`, error: 'AMBIGUOUS' };
    }

    const idx = content.indexOf(oldStr);
    const uri = vscode.Uri.file(file);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(content.split('\n').length - 1, content.split('\n').at(-1)!.length),
    ), content.replace(oldStr, newStr));

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return { success: false, output: 'WorkspaceEdit was rejected', error: 'EDIT_REJECTED' };
    }
    return { success: true, output: `Replaced 1 occurrence in ${file}` };
  });
  result.overridden.push('code_replace');

  // ── code_insert ──
  refs.executor.registerHandler('code_insert', async (args): Promise<ToolResult> => {
    const file = resolve(ws, args['file'] as string);
    const line = args['line'] as number;
    const content = args['content'] as string;

    if (!existsSync(file)) {
      return { success: false, output: 'File not found', error: 'NOT_FOUND' };
    }

    const existing = readFileSync(file, 'utf-8');
    const lines = existing.split('\n');

    if (line < 0 || line > lines.length) {
      return { success: false, output: `Line ${line} out of range (0-${lines.length})`, error: 'OUT_OF_RANGE' };
    }

    const uri = vscode.Uri.file(file);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(line, 0), content + '\n');

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return { success: false, output: 'WorkspaceEdit was rejected', error: 'EDIT_REJECTED' };
    }
    return { success: true, output: `Inserted at line ${line} in ${file}` };
  });
  result.overridden.push('code_insert');

  // ── code_definitions ──
  refs.executor.registerHandler('code_definitions', async (args): Promise<ToolResult> => {
    const file = resolve(ws, args['file'] as string);
    if (!existsSync(file)) {
      return { success: false, output: 'File not found', error: 'NOT_FOUND' };
    }

    try {
      const uri = vscode.Uri.file(file);
      const doc = await vscode.workspace.openTextDocument(uri);
      const positions: vscode.Location[] = [];

      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', uri,
      );

      if (symbols && symbols.length > 0) {
        const definitions: string[] = [];
        const flatten = (syms: vscode.DocumentSymbol[], prefix = '') => {
          for (const sym of syms) {
            const kind = vscode.SymbolKind[sym.kind] ?? 'Unknown';
            definitions.push(`L${sym.range.start.line + 1}: ${kind} ${prefix}${sym.name}`);
            if (sym.children.length > 0) {
              flatten(sym.children, `${prefix}${sym.name}.`);
            }
          }
        };
        flatten(symbols);
        return { success: true, output: definitions.join('\n'), metadata: { count: definitions.length } };
      }

      return { success: true, output: 'No definitions found' };
    } catch (error) {
      return { success: false, output: `Definitions failed: ${(error as Error).message}`, error: 'DEFINITIONS_ERROR' };
    }
  });
  result.overridden.push('code_definitions');

  // ── code_symbols ──
  refs.executor.registerHandler('code_symbols', async (args): Promise<ToolResult> => {
    const file = resolve(ws, args['file'] as string);
    if (!existsSync(file)) {
      return { success: false, output: 'File not found', error: 'NOT_FOUND' };
    }

    try {
      const uri = vscode.Uri.file(file);
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', uri,
      );

      if (symbols && symbols.length > 0) {
        const items: Array<{ name: string; kind: string; line: number }> = [];
        const flatten = (syms: vscode.DocumentSymbol[]) => {
          for (const sym of syms) {
            items.push({
              name: sym.name,
              kind: vscode.SymbolKind[sym.kind] ?? 'Unknown',
              line: sym.range.start.line + 1,
            });
            if (sym.children.length > 0) flatten(sym.children);
          }
        };
        flatten(symbols);
        const output = items.map((s) => `${s.kind} ${s.name} (L${s.line})`).join('\n');
        return { success: true, output: output || 'No symbols found', metadata: { count: items.length } };
      }

      return { success: true, output: 'No symbols found' };
    } catch (error) {
      return { success: false, output: `Symbols failed: ${(error as Error).message}`, error: 'SYMBOLS_ERROR' };
    }
  });
  result.overridden.push('code_symbols');

  // ── file_patch (multi-edit) ──
  refs.executor.registerHandler('file_patch', async (args): Promise<ToolResult> => {
    const filePath = resolve(ws, args['file'] as string);
    const edits = args['edits'] as Array<{ search: string; replace: string }>;

    if (!existsSync(filePath)) {
      return { success: false, output: 'File not found', error: 'NOT_FOUND' };
    }
    if (!Array.isArray(edits) || edits.length === 0) {
      return { success: false, output: 'edits must be a non-empty array of {search, replace}', error: 'INVALID_INPUT' };
    }

    let content = readFileSync(filePath, 'utf-8');
    const results: string[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]!;
      if (!content.includes(edit.search)) {
        results.push(`Edit ${i + 1}: FAILED - search string not found`);
        continue;
      }
      const occurrences = content.split(edit.search).length - 1;
      if (occurrences > 1) {
        results.push(`Edit ${i + 1}: FAILED - search string matches ${occurrences} times (must be unique)`);
        continue;
      }
      content = content.replace(edit.search, edit.replace);
      results.push(`Edit ${i + 1}: OK`);
    }

    const uri = vscode.Uri.file(filePath);
    const wsEdit = new vscode.WorkspaceEdit();
    const doc = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length),
    );
    wsEdit.replace(uri, fullRange, content);

    const applied = await vscode.workspace.applyEdit(wsEdit);
    if (!applied) {
      return { success: false, output: 'WorkspaceEdit was rejected', error: 'EDIT_REJECTED' };
    }

    return {
      success: true,
      output: results.join('\n'),
      metadata: { applied: results.filter((r) => r.includes('OK')).length, total: edits.length },
    };
  });
  result.overridden.push('file_patch');

  // ── code_references ──
  refs.executor.registerHandler('code_references', async (args): Promise<ToolResult> => {
    const symbol = args['symbol'] as string;
    const searchPath = (args['path'] as string) ?? '.';
    const cwd = resolve(ws, searchPath);

    try {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(cwd, '**/*.{ts,tsx,js,jsx}'),
        '**/node_modules/**',
        200,
      );

      const refs: string[] = [];
      for (const file of files.slice(0, 50)) {
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          const text = doc.getText();
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes(symbol)) {
              const relPath = file.fsPath.replace(ws + '/', '');
              refs.push(`${relPath}:${i + 1}: ${lines[i]!.trim()}`);
              if (refs.length >= 50) break;
            }
          }
        } catch {
          continue;
        }
        if (refs.length >= 50) break;
      }

      return {
        success: true,
        output: refs.length > 0 ? refs.join('\n') : 'No references found',
        metadata: { symbol, count: refs.length },
      };
    } catch (error) {
      return { success: true, output: 'No references found' };
    }
  });
  result.overridden.push('code_references');

  // ── code_format ──
  refs.executor.registerHandler('code_format', async (args): Promise<ToolResult> => {
    const path = (args['path'] as string) ?? '.';
    const targetPath = resolve(ws, path);

    try {
      const pattern = new vscode.RelativePattern(targetPath, '**/*.{ts,tsx,js,jsx,json,css,md}');
      const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 100);
      let formatted = 0;

      for (const file of files) {
        try {
          const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatDocumentProvider', file,
          );
          if (edits && edits.length > 0) {
            const wsEdit = new vscode.WorkspaceEdit();
            wsEdit.set(file, edits);
            await vscode.workspace.applyEdit(wsEdit);
            formatted++;
          }
        } catch {
          continue;
        }
      }

      return { success: true, output: `Formatted ${formatted} file(s)` };
    } catch (error) {
      return { success: false, output: `Format failed: ${(error as Error).message}`, error: 'FORMAT_ERROR' };
    }
  });
  result.overridden.push('code_format');

  // ── Kept as-is ──
  result.keptAsIs.push(
    'code_search', 'code_grep', 'code_lint', 'code_fix', 'code_typecheck', 'code_analyze',
  );

  return result;
}
```

**VS Code APIs Used**:
- `vscode.WorkspaceEdit` — atomic file edits with undo support
- `vscode.workspace.applyEdit(edit)` — apply workspace edit
- `vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri)` — get document symbols
- `vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', uri)` — get format edits
- `vscode.workspace.findFiles(pattern, exclude, maxResults)` — find files by glob
- `vscode.workspace.openTextDocument(uri)` — open document for reading
- `vscode.RelativePattern(base, pattern)` — workspace-relative glob pattern
- `vscode.SymbolKind` — enum for symbol kind names

**Acceptance Criteria**:
- `code_replace`, `code_insert`, `file_patch` use `WorkspaceEdit` for undo/redo integration
- `code_definitions`, `code_symbols` use VS Code's language server providers
- `code_references` uses `vscode.workspace.findFiles` + text search
- `code_format` uses VS Code's format provider
- 6 tools kept as-is (shell-based, work in extension host)

---

## T5.6: Web & Network Adapter (7 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/web.ts`
**Source**: `packages/engine/src/tools/builtin/web.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `http_get` | `fetch` | Keep as-is (pure fetch) | Keep as-is |
| `http_post` | `fetch` | Keep as-is | Keep as-is |
| `http_request` | `fetch` | Keep as-is | Keep as-is |
| `web_scrape` | `fetch` + regex | Keep as-is | Keep as-is |
| `web_search` | `fetch` DuckDuckGo | Keep as-is | Keep as-is |
| `http_download` | `fetch` + writeFileSync | Keep as-is (scope enforced via context) | Keep as-is |
| `web_browse` | Playwright/fetch | Keep as-is (falls back to fetch) | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptWebNetwork(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'http_get', 'http_post', 'http_request',
      'web_scrape', 'web_search', 'http_download', 'web_browse',
    ],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 7 tools kept as-is — they use `fetch` which works in extension host
- No overrides needed

---

## T5.7: Package Managers Adapter (8 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/packages.ts`
**Source**: `packages/engine/src/tools/builtin/packages.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `package_install` | `execSync` npm/pnpm/yarn | Keep shell-based, cwd = workspace root | Keep as-is |
| `package_remove` | `execSync` npm/pnpm/yarn | Keep shell-based | Keep as-is |
| `package_list` | `readFileSync` package.json | Keep as-is | Keep as-is |
| `package_outdated` | `execSync` npm/pnpm/yarn | Keep shell-based | Keep as-is |
| `package_run` | `execSync` npm/pnpm/yarn | Keep shell-based | Keep as-is |
| `pkg_update` | `execSync` npm/pnpm/yarn | Keep shell-based | Keep as-is |
| `pkg_audit` | `execSync` npm/pnpm audit | Keep shell-based | Keep as-is |
| `pkg_search` | `fetch` npm registry | Keep as-is | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptPackageManagers(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'package_install', 'package_remove', 'package_list', 'package_outdated',
      'package_run', 'pkg_update', 'pkg_audit', 'pkg_search',
    ],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 8 tools kept as-is — they use `execSync` with `cwd = context.scopePath` which is workspace root
- Package manager auto-detection (pnpm/yarn/npm) works correctly

---

## T5.8: Security & Crypto Adapter (4 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/security.ts`
**Source**: `packages/engine/src/tools/builtin/security.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `encrypt_file` | `node:crypto` + `node:fs` | Keep as-is (pure JS crypto) | Keep as-is |
| `decrypt_file` | `node:crypto` + `node:fs` | Keep as-is | Keep as-is |
| `jwt_decode` | `Buffer.from` base64 | Keep as-is | Keep as-is |
| `secret_generate` | `node:crypto` randomBytes | Keep as-is | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptSecurityCrypto(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['encrypt_file', 'decrypt_file', 'jwt_decode', 'secret_generate'],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 4 tools kept as-is — pure JS crypto, works in extension host

---

## T5.9: AI Meta-Tools Adapter (7 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/ai.ts`
**Source**: `packages/engine/src/tools/builtin/ai.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `ai_complete` | Dynamic import LLM module | Keep as-is (provider API calls) | Keep as-is |
| `ai_embed` | Dynamic import embeddings | Keep as-is | Keep as-is |
| `ai_summarize` | Dynamic import LLM module | Keep as-is | Keep as-is |
| `ai_classify` | Dynamic import LLM module | Keep as-is | Keep as-is |
| `ai_extract` | Dynamic import LLM module | Keep as-is | Keep as-is |
| `memory_store` | Dynamic import memory module | Keep as-is | Keep as-is |
| `memory_recall` | Dynamic import memory module | Keep as-is | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptAiMeta(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'ai_complete', 'ai_embed', 'ai_summarize',
      'ai_classify', 'ai_extract', 'memory_store', 'memory_recall',
    ],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 7 tools kept as-is — they use dynamic imports and provider API calls

---

## T5.10: Scheduler Adapter (3 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/scheduler.ts`
**Source**: `packages/engine/src/tools/builtin/scheduler.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `reminder_set` | Scheduler singleton | Keep as-is (singleton set by Agent constructor) | Keep as-is |
| `reminder_list` | Scheduler singleton | Keep as-is | Keep as-is |
| `reminder_cancel` | Scheduler singleton | Keep as-is | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptScheduler(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['reminder_set', 'reminder_list', 'reminder_cancel'],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 3 tools kept as-is — they use the Scheduler singleton set during Agent construction

---

## T5.11: Agent Orchestration Adapter (3 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/subagent.ts`
**Source**: `packages/engine/src/tools/builtin/subagent.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `sub_agent_spawn` | SubAgentManager singleton | Keep as-is | Keep as-is |
| `sub_agent_status` | SubAgentManager singleton | Keep as-is | Keep as-is |
| `sub_agent_cancel` | SubAgentManager singleton | Keep as-is | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptAgentOrchestration(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['sub_agent_spawn', 'sub_agent_status', 'sub_agent_cancel'],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 3 tools kept as-is — they use the SubAgentManager singleton

---

## T5.12: Data Processing Adapter (8 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/data.ts`
**Source**: `packages/engine/src/tools/builtin/data.ts`
**Priority**: P1

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `json_parse` | `JSON.parse` | Keep as-is (pure JS) | Keep as-is |
| `json_query` | dot-notation traversal | Keep as-is | Keep as-is |
| `json_set` | dot-notation + writeFileSync | Keep as-is | Keep as-is |
| `csv_parse` | string splitting | Keep as-is | Keep as-is |
| `text_transform` | string operations | Keep as-is | Keep as-is |
| `regex_match` | `RegExp` | Keep as-is | Keep as-is |
| `text_diff` | line comparison | Keep as-is | Keep as-is |
| `validate_schema` | JSON Schema validation | Keep as-is | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptDataProcessing(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'json_parse', 'json_query', 'json_set', 'csv_parse',
      'text_transform', 'regex_match', 'text_diff', 'validate_schema',
    ],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 8 tools kept as-is — pure JS implementations

---

## T5.13: Documents Adapter (15 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/documents.ts`
**Source**: `packages/engine/src/tools/builtin/documents.ts`
**Priority**: P2

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `csv_create` | Pure JS | Keep as-is | Keep as-is |
| `pdf_create` | Pure JS PDF builder | Keep as-is | Keep as-is |
| `docx_create` | Pure JS OOXML builder | Keep as-is | Keep as-is |
| `pptx_create` | Pure JS OOXML builder | Keep as-is | Keep as-is |
| `xlsx_create` | Pure JS OOXML builder | Keep as-is | Keep as-is |
| `pdf_read` | Pure JS PDF parser | Keep as-is | Keep as-is |
| `docx_read` | Pure JS ZIP + XML parser | Keep as-is | Keep as-is |
| `xlsx_read` | Pure JS ZIP + XML parser | Keep as-is | Keep as-is |
| `pptx_read` | Pure JS ZIP + XML parser | Keep as-is | Keep as-is |
| `doc_markdown` | Pure JS writeFileSync | Keep as-is | Keep as-is |
| `doc_html` | Pure JS writeFileSync | Keep as-is | Keep as-is |
| `doc_json` | Pure JS writeFileSync | Keep as-is | Keep as-is |
| `doc_yaml` | Pure JS writeFileSync | Keep as-is | Keep as-is |
| `doc_diagram` | Pure JS writeFileSync | Keep as-is | Keep as-is |
| `doc_latex` | Pure JS writeFileSync | Keep as-is | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptDocuments(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'csv_create', 'pdf_create', 'docx_create', 'pptx_create', 'xlsx_create',
      'pdf_read', 'docx_read', 'xlsx_read', 'pptx_read',
      'doc_markdown', 'doc_html', 'doc_json', 'doc_yaml', 'doc_diagram', 'doc_latex',
    ],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 15 tools kept as-is — all use pure JS builders/parsers with no shell dependencies

---

## T5.14: Containers & Infra Adapter (9 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/containers.ts`
**Source**: `packages/engine/src/tools/builtin/containers.ts`
**Priority**: P2

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `container_list` | `execSync docker ps` | Keep shell-based (docker CLI works in extension host) | Keep as-is |
| `container_logs` | `execSync docker logs` | Keep shell-based | Keep as-is |
| `container_start` | `execSync docker start` | Keep shell-based | Keep as-is |
| `container_stop` | `execSync docker stop` | Keep shell-based | Keep as-is |
| `container_exec` | `execSync docker exec` | Keep shell-based | Keep as-is |
| `container_run` | `execSync docker run` | Keep shell-based | Keep as-is |
| `container_compose` | `execSync docker compose` | Keep shell-based | Keep as-is |
| `container_images` | `execSync docker images` | Keep shell-based | Keep as-is |
| `docker_build` | `execSync docker build` | Keep shell-based | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptContainersInfra(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'container_list', 'container_logs', 'container_start', 'container_stop',
      'container_exec', 'container_run', 'container_compose', 'container_images', 'docker_build',
    ],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 9 tools kept as-is — docker CLI works in extension host process

---

## T5.15: Database Adapter (5 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/database.ts`
**Source**: `packages/engine/src/tools/builtin/database.ts`
**Priority**: P2

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `db_query` | `execFileSync sqlite3` | Keep shell-based (sqlite3 CLI) | Keep as-is |
| `db_schema` | `execFileSync sqlite3` | Keep shell-based | Keep as-is |
| `db_export` | `execFileSync sqlite3` | Keep shell-based | Keep as-is |
| `env_read` | `readFileSync` + mask | Keep as-is (pure JS) | Keep as-is |
| `db_migrate` | `execFileSync sqlite3` | Keep shell-based | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptDatabase(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['db_query', 'db_schema', 'db_export', 'env_read', 'db_migrate'],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 5 tools kept as-is — use `sqlite3` CLI which works in extension host
- If `sqlite3` is not installed, the tools return graceful errors (existing behavior)

---

## T5.16: GitHub Adapter (9 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/github.ts`
**Source**: `packages/engine/src/tools/builtin/github.ts`
**Priority**: P2

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `gh_issue_list` | `execSync gh` | Keep shell-based (`gh` CLI) | Keep as-is |
| `gh_issue_create` | `execSync gh` | Keep shell-based | Keep as-is |
| `gh_pr_list` | `execSync gh` | Keep shell-based | Keep as-is |
| `gh_pr_create` | `execSync gh` | Keep shell-based | Keep as-is |
| `gh_pr_view` | `execSync gh` | Keep shell-based | Keep as-is |
| `gh_repo_view` | `execSync gh` | Keep shell-based | Keep as-is |
| `gh_workflow_list` | `execSync gh` | Keep shell-based | Keep as-is |
| `gh_release` | `execSync gh` | Keep shell-based | Keep as-is |
| `gh_pr_review` | `execSync gh` | Keep shell-based | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptGithub(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'gh_issue_list', 'gh_issue_create', 'gh_pr_list', 'gh_pr_create',
      'gh_pr_view', 'gh_repo_view', 'gh_workflow_list', 'gh_release', 'gh_pr_review',
    ],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 9 tools kept as-is — `gh` CLI works in extension host

---

## T5.17: Testing Adapter (5 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/testing.ts`
**Source**: `packages/engine/src/tools/builtin/testing.ts`
**Priority**: P2

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `test_run` | `execSync vitest` | Keep shell-based | Keep as-is |
| `test_watch` | `execSync vitest` | Keep shell-based | Keep as-is |
| `test_coverage` | `execSync vitest --coverage` | Keep shell-based | Keep as-is |
| `test_create` | `node:fs` scaffold | Keep as-is (pure JS) | Keep as-is |
| `benchmark_run` | `execSync vitest bench` | Keep shell-based | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptTesting(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['test_run', 'test_watch', 'test_coverage', 'test_create', 'benchmark_run'],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 5 tools kept as-is — vitest CLI works in extension host

---

## T5.18: System & OS Adapter (12 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/system.ts`
**Source**: `packages/engine/src/tools/builtin/system.ts`
**Priority**: P2

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `system_info` | `node:os` | Keep as-is (pure Node.js) | Keep as-is |
| `system_disk` | `execSync df` | Keep shell-based | Keep as-is |
| `system_env` | `process.env` | Keep as-is | Keep as-is |
| `system_which` | `execSync which` | Keep shell-based | Keep as-is |
| `system_ports` | `execSync lsof/netstat` | Keep shell-based | Keep as-is |
| `system_tree_size` | `execSync du` | Keep shell-based | Keep as-is |
| `security_audit` | `execSync npm audit` | Keep shell-based | Keep as-is |
| `security_secrets` | `execSync grep` | Keep shell-based | Keep as-is |
| `file_checksum` | `node:crypto` + `node:fs` | Keep as-is | Keep as-is |
| `system_monitor` | `execSync top` | Keep shell-based | Keep as-is |
| `cron_create` | `execSync crontab` | Keep shell-based | Keep as-is |
| `open_app` | `execSync open` | Use `vscode.env.openExternal` for URLs, keep shell for apps | Override |

### Implementation

```typescript
import * as vscode from 'vscode';
import { execSync } from 'node:child_process';
import type { ToolResult } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptSystemOs(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };

  // ── open_app ──
  refs.executor.registerHandler('open_app', async (args): Promise<ToolResult> => {
    const target = args['target'] as string;
    if (!target) return { success: false, output: 'target is required', error: 'MISSING_INPUT' };

    try {
      if (target.startsWith('http://') || target.startsWith('https://')) {
        const opened = await vscode.env.openExternal(vscode.Uri.parse(target));
        return { success: opened, output: opened ? `Opened URL: ${target}` : 'Failed to open URL' };
      }
      const cmd = process.platform === 'win32' ? `start "" "${target}"` : `open "${target}"`;
      execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
      return { success: true, output: `Opened: ${target}` };
    } catch (error) {
      return { success: false, output: `Failed to open: ${(error as Error).message}`, error: 'OPEN_ERROR' };
    }
  });
  result.overridden.push('open_app');

  // ── Kept as-is ──
  result.keptAsIs.push(
    'system_info', 'system_disk', 'system_env', 'system_which', 'system_ports',
    'system_tree_size', 'security_audit', 'security_secrets', 'file_checksum',
    'system_monitor', 'cron_create',
  );

  return result;
}
```

**VS Code APIs Used**:
- `vscode.env.openExternal(uri)` — open URL in default browser

**Acceptance Criteria**:
- `open_app` uses `vscode.env.openExternal` for URLs
- 11 tools kept as-is

---

## T5.19: Browser Automation Adapter (6 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/browser.ts`
**Source**: `packages/engine/src/tools/builtin/browser.ts`
**Priority**: P3

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `browser_open` | Playwright | Disable — not relevant in VS Code | Disable |
| `browser_screenshot` | Playwright | Disable | Disable |
| `browser_click` | Playwright | Disable | Disable |
| `browser_eval` | Playwright | Disable | Disable |
| `browser_type` | Playwright | Disable | Disable |
| `browser_extract` | Playwright | Disable | Disable |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';
import { createDisabledHandler } from './types';

export function adaptBrowserAutomation(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const reason = 'Browser automation via Playwright is not supported in the VS Code extension host';

  const tools = [
    'browser_open', 'browser_screenshot', 'browser_click',
    'browser_eval', 'browser_type', 'browser_extract',
  ];

  for (const toolId of tools) {
    refs.executor.registerHandler(toolId, createDisabledHandler(toolId, reason));
    result.disabled.push(toolId);
  }

  return result;
}
```

**Acceptance Criteria**:
- All 6 browser tools return `{ success: false, error: 'NOT_AVAILABLE_IN_VSCODE' }`
- Error message clearly explains the limitation

---

## T5.20: Communication Adapter (5 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/communication.ts`
**Source**: `packages/engine/src/tools/builtin/notifications.ts`
**Priority**: P3

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `notify_desktop` | `execSync osascript` | Replace with `vscode.window.showInformationMessage` | Override |
| `notify_telegram` | `fetch` Telegram API | Keep as-is (if env vars configured) | Keep as-is |
| `notify_slack` | `fetch` Slack webhook | Keep as-is (if env vars configured) | Keep as-is |
| `clipboard_read` | `execSync pbpaste` | Use `vscode.env.clipboard.readText()` | Override |
| `clipboard_write` | `execSync pbcopy` | Use `vscode.env.clipboard.writeText()` | Override |

### Implementation

```typescript
import * as vscode from 'vscode';
import type { ToolResult } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptCommunication(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };

  // ── notify_desktop ──
  refs.executor.registerHandler('notify_desktop', async (args): Promise<ToolResult> => {
    const title = args['title'] as string;
    const message = args['message'] as string;

    if (!title || !message) {
      return { success: false, output: 'title and message are required', error: 'MISSING_INPUT' };
    }

    const selection = await vscode.window.showInformationMessage(
      `${title}: ${message}`,
      'OK',
    );
    return { success: true, output: `Notification shown: ${title} - ${message}` };
  });
  result.overridden.push('notify_desktop');

  // ── clipboard_read ──
  refs.executor.registerHandler('clipboard_read', async (): Promise<ToolResult> => {
    try {
      const text = await vscode.env.clipboard.readText();
      return { success: true, output: text || '(clipboard empty)' };
    } catch (error) {
      return { success: false, output: `Clipboard read failed: ${(error as Error).message}`, error: 'CLIPBOARD_ERROR' };
    }
  });
  result.overridden.push('clipboard_read');

  // ── clipboard_write ──
  refs.executor.registerHandler('clipboard_write', async (args): Promise<ToolResult> => {
    const text = args['text'] as string;
    if (text === undefined) {
      return { success: false, output: 'text is required', error: 'MISSING_INPUT' };
    }
    try {
      await vscode.env.clipboard.writeText(text);
      return { success: true, output: `Copied to clipboard: ${text.length > 50 ? text.slice(0, 50) + '...' : text}` };
    } catch (error) {
      return { success: false, output: `Clipboard write failed: ${(error as Error).message}`, error: 'CLIPBOARD_ERROR' };
    }
  });
  result.overridden.push('clipboard_write');

  // ── Kept as-is ──
  result.keptAsIs.push('notify_telegram', 'notify_slack');

  return result;
}
```

**VS Code APIs Used**:
- `vscode.window.showInformationMessage(message, ...items)` — show notification toast
- `vscode.env.clipboard.readText()` — async clipboard read
- `vscode.env.clipboard.writeText(text)` — async clipboard write

**Acceptance Criteria**:
- `notify_desktop` shows VS Code information message instead of osascript
- `clipboard_read`/`clipboard_write` use VS Code clipboard API (cross-platform)
- `notify_telegram`/`notify_slack` kept as-is (fetch-based)

---

## T5.21: Media & Image Adapter (4 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/media.ts`
**Source**: `packages/engine/src/tools/builtin/media.ts`, `packages/engine/src/tools/builtin/image.ts`
**Priority**: P3

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `chart_generate` | Pure JS SVG builder | Keep as-is (pure JS) | Keep as-is |
| `qr_generate` | `execSync` qrcode / fetch API | Keep as-is (has API fallback) | Keep as-is |
| `image_view` | `execSync sips`/`identify` | Keep as-is (graceful fallback) | Keep as-is |
| `image_resize` | `execSync sips`/`convert` | Disable — shell-dependent image tools | Disable |
| `image_convert` | `execSync sips`/`convert` | Disable — shell-dependent | Disable |
| `image_ocr` | `execSync tesseract` | Disable — requires Tesseract | Disable |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';
import { createDisabledHandler } from './types';

export function adaptMediaImage(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };

  const disabledTools = ['image_resize', 'image_convert', 'image_ocr'];
  const reason = 'Image processing tools require system-level binaries (sips/ImageMagick/Tesseract) that may not be available';

  for (const toolId of disabledTools) {
    refs.executor.registerHandler(toolId, createDisabledHandler(toolId, reason));
    result.disabled.push(toolId);
  }

  result.keptAsIs.push('chart_generate', 'qr_generate', 'image_view');

  return result;
}
```

**Acceptance Criteria**:
- `chart_generate`, `qr_generate`, `image_view` kept as-is
- `image_resize`, `image_convert`, `image_ocr` return disabled stubs

---

## T5.22: MCP Integration Adapter (4 tools)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/tools/mcp.ts`
**Source**: `packages/engine/src/tools/builtin/mcp.ts`
**Priority**: P2

### Tool Disposition

| Tool ID | Default Handler | VS Code Strategy | Action |
|---------|----------------|-----------------|--------|
| `mcp_call` | `spawn` stdio | Keep as-is (spawn works in extension host) | Keep as-is |
| `mcp_list_tools` | `spawn` stdio | Keep as-is | Keep as-is |
| `mcp_server_connect` | `spawn` stdio | Keep as-is | Keep as-is |
| `mcp_resource_read` | `spawn` stdio | Keep as-is | Keep as-is |

### Implementation

```typescript
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptMcpIntegration(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['mcp_call', 'mcp_list_tools', 'mcp_server_connect', 'mcp_resource_read'],
    disabled: [],
  };
}
```

**Acceptance Criteria**:
- All 4 tools kept as-is — spawn-based MCP stdio transport works in extension host

---

## T5.22: Verification & Testing

**Status**: ⬜ Not Started
**Estimated Effort**: 1 day

### T5.22.1: Unit Tests for Adapter Manager

**File**: `packages/vscode/src/adapter/tools/__tests__/ToolAdapterManager.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('ToolAdapterManager', () => {
  it('should produce a complete adaptation report', () => {
    const mockRegistry = {
      list: () => Array.from({ length: 165 }, (_, i) => ({
        id: `tool_${i}`,
        name: `tool_${i}`,
        description: '',
        modelDescription: '',
        category: 'filesystem' as const,
        riskLevel: 'low' as const,
        schema: { type: 'object' as const, properties: {} },
        composable: true,
        source: 'builtin' as const,
      })),
      get: () => undefined,
      register: vi.fn(),
    };

    const handlers = new Map<string, Function>();
    const mockExecutor = {
      registerHandler: vi.fn((id: string, handler: Function) => {
        handlers.set(id, handler);
      }),
      execute: vi.fn(),
    };

    // The report should account for all tools
    // overridden + keptAsIs + disabled should equal total registered tools per category
  });
});
```

### T5.22.2: Verification Checklist

For each tool category, verify in Extension Development Host:

**P1 Categories:**

| Category | Verification Steps |
|----------|-------------------|
| filesystem | 1. `file_read` reads a workspace file via `vscode.workspace.fs` 2. `file_write` creates a file visible in VS Code explorer 3. `file_delete` moves file to trash 4. `file_open` opens file in editor tab 5. `folder_list` returns correct entries |
| shell_process | 1. `shell_exec` runs `echo hello` with cwd = workspace root 2. `shell_exec_streaming` output appears in Agent-X output channel |
| git_vcs | 1. `git_status` returns correct status using VS Code Git API 2. Fallback to shell when Git extension not active |
| code_intelligence | 1. `code_replace` modifies file with undo support 2. `code_symbols` returns symbols from language server 3. `code_format` formats using VS Code formatter |
| web_network | 1. `http_get` fetches a URL 2. `web_search` returns results |
| package_managers | 1. `package_list` shows workspace deps 2. `package_run` executes a script |
| security_crypto | 1. `secret_generate` generates a hex string 2. `jwt_decode` decodes a token |
| ai_meta | 1. `ai_summarize` calls LLM provider 2. `memory_store`/`memory_recall` round-trip |
| scheduler | 1. `reminder_set` creates a timer 2. `reminder_list` shows it |
| agent_orchestration | 1. `sub_agent_spawn` creates a sub-agent |
| data_processing | 1. `json_parse` parses a JSON string 2. `text_transform` uppercase works |

**P2 Categories:**

| Category | Verification Steps |
|----------|-------------------|
| documents | 1. `pdf_create` creates a valid PDF 2. `doc_markdown` writes a .md file |
| containers_infra | 1. `container_list` returns docker ps output (if docker installed) |
| database | 1. `env_read` reads and masks .env file |
| github | 1. `gh_repo_view` returns repo info (if gh CLI installed) |
| testing | 1. `test_create` scaffolds a test file |
| system_os | 1. `system_info` returns OS info 2. `open_app` opens a URL in browser |
| mcp_integration | 1. Verify tools are callable (requires MCP server) |

**P3 Categories:**

| Category | Verification Steps |
|----------|-------------------|
| browser_automation | 1. All 6 tools return `NOT_AVAILABLE_IN_VSCODE` error |
| communication | 1. `notify_desktop` shows VS Code toast 2. `clipboard_write`/`clipboard_read` round-trip |
| media_image | 1. `chart_generate` creates SVG 2. `image_resize` returns disabled message |

### T5.22.3: Scope Enforcement Verification

```typescript
// Verify all overridden filesystem tools respect workspace root
// Test: attempt to read a file outside workspace root
// Expected: ScopeGuard rejects before handler is invoked

// Verify shell_exec cwd is workspace root
// Test: shell_exec('pwd') should return workspace root path

// Verify file_write creates files within workspace
// Test: file_write('test.txt', 'hello') should create file at workspaceRoot/test.txt
```

### T5.22.4: Disabled Tools Verification

```typescript
// Verify all disabled tools return consistent error format
// Expected: { success: false, error: 'NOT_AVAILABLE_IN_VSCODE', output: '...' }

const disabledTools = [
  'browser_open', 'browser_screenshot', 'browser_click',
  'browser_eval', 'browser_type', 'browser_extract',
  'image_resize', 'image_convert', 'image_ocr',
];

for (const toolId of disabledTools) {
  const result = await executor.execute(toolId, {}, 'test-session');
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'NOT_AVAILABLE_IN_VSCODE');
  assert.ok(result.output.includes('not available in VS Code'));
}
```

### T5.22.5: Build & Lint Verification

```bash
pnpm --filter @agentx/vscode run typecheck
pnpm --filter @agentx/vscode run lint
pnpm --filter @agentx/vscode run build
```

**Acceptance Criteria**:
- All P1 tools verified functional in Extension Development Host
- All disabled tools return `NOT_AVAILABLE_IN_VSCODE` error
- Scope enforcement prevents file access outside workspace root
- `shell_exec` cwd is always workspace root
- Typecheck and lint pass with zero errors
- Adaptation report accounts for all 165+ tools

---

## Summary: Complete Tool Disposition Matrix

| # | Tool ID | Category | Action | Handler File |
|---|---------|----------|--------|-------------|
| 1 | `file_read` | filesystem | Override | `filesystem.ts` |
| 2 | `file_write` | filesystem | Override | `filesystem.ts` |
| 3 | `file_delete` | filesystem | Override | `filesystem.ts` |
| 4 | `folder_create` | filesystem | Override | `filesystem.ts` |
| 5 | `folder_delete` | filesystem | Override | `filesystem.ts` |
| 6 | `folder_list` | filesystem | Override | `filesystem.ts` |
| 7 | `folder_move` | filesystem | Override | `filesystem.ts` |
| 8 | `file_copy` | filesystem | Override | `filesystem.ts` |
| 9 | `file_find` | filesystem | Keep | — |
| 10 | `file_diff` | filesystem | Keep | — |
| 11 | `file_metadata` | filesystem | Override | `filesystem.ts` |
| 12 | `file_open` | filesystem | Override | `filesystem.ts` |
| 13 | `folder_tree` | filesystem | Keep | — |
| 14 | `folder_open` | filesystem | Override | `filesystem.ts` |
| 15 | `archive_create` | filesystem | Keep | — |
| 16 | `archive_extract` | filesystem | Keep | — |
| 17 | `shell_exec` | shell_process | Override | `shell.ts` |
| 18 | `shell_exec_streaming` | shell_process | Override | `shell.ts` |
| 19 | `shell_background` | shell_process | Keep | — |
| 20 | `process_kill` | shell_process | Keep | — |
| 21 | `process_list` | shell_process | Keep | — |
| 22 | `git_status` | git_vcs | Override | `git.ts` |
| 23 | `git_diff` | git_vcs | Override | `git.ts` |
| 24 | `git_log` | git_vcs | Keep | — |
| 25 | `git_commit` | git_vcs | Keep | — |
| 26 | `git_add` | git_vcs | Keep | — |
| 27 | `git_branch` | git_vcs | Keep | — |
| 28 | `git_checkout` | git_vcs | Keep | — |
| 29 | `git_stash` | git_vcs | Keep | — |
| 30 | `git_blame` | git_vcs | Keep | — |
| 31 | `git_show` | git_vcs | Keep | — |
| 32 | `git_push` | git_vcs | Keep | — |
| 33 | `git_pull` | git_vcs | Keep | — |
| 34 | `git_merge` | git_vcs | Keep | — |
| 35 | `code_search` | code_intelligence | Keep | — |
| 36 | `code_replace` | code_intelligence | Override | `code.ts` |
| 37 | `code_insert` | code_intelligence | Override | `code.ts` |
| 38 | `code_definitions` | code_intelligence | Override | `code.ts` |
| 39 | `code_symbols` | code_intelligence | Override | `code.ts` |
| 40 | `file_patch` | code_intelligence | Override | `code.ts` |
| 41 | `code_grep` | code_intelligence | Keep | — |
| 42 | `code_references` | code_intelligence | Override | `code.ts` |
| 43 | `code_format` | code_intelligence | Override | `code.ts` |
| 44 | `code_lint` | code_intelligence | Keep | — |
| 45 | `code_fix` | code_intelligence | Keep | — |
| 46 | `code_typecheck` | code_intelligence | Keep | — |
| 47 | `code_analyze` | code_intelligence | Keep | — |
| 48 | `http_get` | web_network | Keep | — |
| 49 | `http_post` | web_network | Keep | — |
| 50 | `http_request` | web_network | Keep | — |
| 51 | `web_scrape` | web_network | Keep | — |
| 52 | `web_search` | web_network | Keep | — |
| 53 | `http_download` | web_network | Keep | — |
| 54 | `web_browse` | web_network | Keep | — |
| 55 | `package_install` | package_managers | Keep | — |
| 56 | `package_remove` | package_managers | Keep | — |
| 57 | `package_list` | package_managers | Keep | — |
| 58 | `package_outdated` | package_managers | Keep | — |
| 59 | `package_run` | package_managers | Keep | — |
| 60 | `pkg_update` | package_managers | Keep | — |
| 61 | `pkg_audit` | package_managers | Keep | — |
| 62 | `pkg_search` | package_managers | Keep | — |
| 63 | `encrypt_file` | security_crypto | Keep | — |
| 64 | `decrypt_file` | security_crypto | Keep | — |
| 65 | `jwt_decode` | security_crypto | Keep | — |
| 66 | `secret_generate` | security_crypto | Keep | — |
| 67 | `ai_complete` | ai_meta | Keep | — |
| 68 | `ai_embed` | ai_meta | Keep | — |
| 69 | `ai_summarize` | ai_meta | Keep | — |
| 70 | `ai_classify` | ai_meta | Keep | — |
| 71 | `ai_extract` | ai_meta | Keep | — |
| 72 | `memory_store` | ai_meta | Keep | — |
| 73 | `memory_recall` | ai_meta | Keep | — |
| 74 | `reminder_set` | scheduler | Keep | — |
| 75 | `reminder_list` | scheduler | Keep | — |
| 76 | `reminder_cancel` | scheduler | Keep | — |
| 77 | `sub_agent_spawn` | agent_orchestration | Keep | — |
| 78 | `sub_agent_status` | agent_orchestration | Keep | — |
| 79 | `sub_agent_cancel` | agent_orchestration | Keep | — |
| 80 | `json_parse` | data_processing | Keep | — |
| 81 | `json_query` | data_processing | Keep | — |
| 82 | `json_set` | data_processing | Keep | — |
| 83 | `csv_parse` | data_processing | Keep | — |
| 84 | `text_transform` | data_processing | Keep | — |
| 85 | `regex_match` | data_processing | Keep | — |
| 86 | `text_diff` | data_processing | Keep | — |
| 87 | `validate_schema` | data_processing | Keep | — |
| 88 | `csv_create` | documents | Keep | — |
| 89 | `pdf_create` | documents | Keep | — |
| 90 | `docx_create` | documents | Keep | — |
| 91 | `pptx_create` | documents | Keep | — |
| 92 | `xlsx_create` | documents | Keep | — |
| 93 | `pdf_read` | documents | Keep | — |
| 94 | `docx_read` | documents | Keep | — |
| 95 | `xlsx_read` | documents | Keep | — |
| 96 | `pptx_read` | documents | Keep | — |
| 97 | `doc_markdown` | documents | Keep | — |
| 98 | `doc_html` | documents | Keep | — |
| 99 | `doc_json` | documents | Keep | — |
| 100 | `doc_yaml` | documents | Keep | — |
| 101 | `doc_diagram` | documents | Keep | — |
| 102 | `doc_latex` | documents | Keep | — |
| 103 | `container_list` | containers_infra | Keep | — |
| 104 | `container_logs` | containers_infra | Keep | — |
| 105 | `container_start` | containers_infra | Keep | — |
| 106 | `container_stop` | containers_infra | Keep | — |
| 107 | `container_exec` | containers_infra | Keep | — |
| 108 | `container_run` | containers_infra | Keep | — |
| 109 | `container_compose` | containers_infra | Keep | — |
| 110 | `container_images` | containers_infra | Keep | — |
| 111 | `docker_build` | containers_infra | Keep | — |
| 112 | `db_query` | database | Keep | — |
| 113 | `db_schema` | database | Keep | — |
| 114 | `db_export` | database | Keep | — |
| 115 | `env_read` | database | Keep | — |
| 116 | `db_migrate` | database | Keep | — |
| 117 | `gh_issue_list` | github | Keep | — |
| 118 | `gh_issue_create` | github | Keep | — |
| 119 | `gh_pr_list` | github | Keep | — |
| 120 | `gh_pr_create` | github | Keep | — |
| 121 | `gh_pr_view` | github | Keep | — |
| 122 | `gh_repo_view` | github | Keep | — |
| 123 | `gh_workflow_list` | github | Keep | — |
| 124 | `gh_release` | github | Keep | — |
| 125 | `gh_pr_review` | github | Keep | — |
| 126 | `test_run` | testing | Keep | — |
| 127 | `test_watch` | testing | Keep | — |
| 128 | `test_coverage` | testing | Keep | — |
| 129 | `test_create` | testing | Keep | — |
| 130 | `benchmark_run` | testing | Keep | — |
| 131 | `system_info` | system_os | Keep | — |
| 132 | `system_disk` | system_os | Keep | — |
| 133 | `system_env` | system_os | Keep | — |
| 134 | `system_which` | system_os | Keep | — |
| 135 | `system_ports` | system_os | Keep | — |
| 136 | `system_tree_size` | system_os | Keep | — |
| 137 | `security_audit` | system_os | Keep | — |
| 138 | `security_secrets` | system_os | Keep | — |
| 139 | `file_checksum` | system_os | Keep | — |
| 140 | `system_monitor` | system_os | Keep | — |
| 141 | `cron_create` | system_os | Keep | — |
| 142 | `open_app` | system_os | Override | `system.ts` |
| 143 | `mcp_call` | mcp_integration | Keep | — |
| 144 | `mcp_list_tools` | mcp_integration | Keep | — |
| 145 | `mcp_server_connect` | mcp_integration | Keep | — |
| 146 | `mcp_resource_read` | mcp_integration | Keep | — |
| 147 | `browser_open` | browser_automation | Disable | `browser.ts` |
| 148 | `browser_screenshot` | browser_automation | Disable | `browser.ts` |
| 149 | `browser_click` | browser_automation | Disable | `browser.ts` |
| 150 | `browser_eval` | browser_automation | Disable | `browser.ts` |
| 151 | `browser_type` | browser_automation | Disable | `browser.ts` |
| 152 | `browser_extract` | browser_automation | Disable | `browser.ts` |
| 153 | `notify_desktop` | communication | Override | `communication.ts` |
| 154 | `notify_telegram` | communication | Keep | — |
| 155 | `notify_slack` | communication | Keep | — |
| 156 | `clipboard_read` | communication | Override | `communication.ts` |
| 157 | `clipboard_write` | communication | Override | `communication.ts` |
| 158 | `chart_generate` | media_image | Keep | — |
| 159 | `qr_generate` | media_image | Keep | — |
| 160 | `image_view` | media_image | Keep | — |
| 161 | `image_resize` | media_image | Disable | `media.ts` |
| 162 | `image_convert` | media_image | Disable | `media.ts` |
| 163 | `image_ocr` | media_image | Disable | `media.ts` |
| 164 | `project_detect` | project_management | Keep | — |
| 165 | `ask_clarification` | agent_meta | Keep | — |
| 166 | `delegate_to_subagent` | agent_meta | Keep | — |
| 167 | `python_rpc` | agent_meta | Keep | — |
| 168 | `telegram_send_file` | communication | Keep | — |

### Final Tally

| Action | Count | Percentage |
|--------|-------|-----------|
| Override | 24 | 14.3% |
| Keep as-is | 135 | 80.4% |
| Disable | 9 | 5.3% |
| **Total** | **168** | **100%** |
