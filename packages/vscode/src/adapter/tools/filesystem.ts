import * as vscode from 'vscode';
import { statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { ToolResult } from '@agentx/shared';
import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptFilesystem(
  refs: ToolkitRefs,
  ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };
  const ws = ctx.workspaceRoot;

  // ── file_read ──
  refs.executor.registerHandler('file_read', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('file_write', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('file_delete', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('folder_create', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('folder_delete', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('folder_list', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('folder_move', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('file_copy', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('file_metadata', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('file_open', async (args, _context): Promise<ToolResult> => {
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
  refs.executor.registerHandler('folder_open', async (args, _context): Promise<ToolResult> => {
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
