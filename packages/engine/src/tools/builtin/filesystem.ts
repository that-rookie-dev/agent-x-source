import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { IS_WINDOWS } from '../platform.js';

export async function fileRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['path'] as string);
  try {
    const content = readFileSync(filePath, 'utf-8');
    return { success: true, output: content };
  } catch (error) {
    return { success: false, output: `Failed to read file: ${(error as Error).message}`, error: 'READ_ERROR' };
  }
}

export async function fileWrite(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['path'] as string);
  const content = args['content'] as string;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    return { success: true, output: `Written to ${filePath}` };
  } catch (error) {
    return { success: false, output: `Failed to write file: ${(error as Error).message}`, error: 'WRITE_ERROR' };
  }
}

export async function fileDelete(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['path'] as string);
  try {
    if (!existsSync(filePath)) {
      return { success: false, output: 'File does not exist', error: 'NOT_FOUND' };
    }
    unlinkSync(filePath);
    return { success: true, output: `Deleted ${filePath}` };
  } catch (error) {
    return { success: false, output: `Failed to delete file: ${(error as Error).message}`, error: 'DELETE_ERROR' };
  }
}

export async function folderCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dirPath = resolve(context.scopePath, args['path'] as string);
  try {
    mkdirSync(dirPath, { recursive: true });
    return { success: true, output: `Created directory ${dirPath}` };
  } catch (error) {
    return { success: false, output: `Failed to create directory: ${(error as Error).message}`, error: 'MKDIR_ERROR' };
  }
}

export async function folderDelete(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dirPath = resolve(context.scopePath, args['path'] as string);
  try {
    if (!existsSync(dirPath)) {
      return { success: false, output: 'Directory does not exist', error: 'NOT_FOUND' };
    }
    rmSync(dirPath, { recursive: true });
    return { success: true, output: `Deleted directory ${dirPath}` };
  } catch (error) {
    return { success: false, output: `Failed to delete directory: ${(error as Error).message}`, error: 'RMDIR_ERROR' };
  }
}

export async function folderList(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dirPath = resolve(context.scopePath, (args['path'] as string) ?? '.');
  try {
    if (!existsSync(dirPath)) {
      return { success: false, output: 'Directory does not exist', error: 'NOT_FOUND' };
    }
    const entries = readdirSync(dirPath);
    const details = entries.map((entry) => {
      try {
        const stat = statSync(resolve(dirPath, entry));
        return `${stat.isDirectory() ? 'd' : 'f'} ${entry}`;
      } catch {
        return `? ${entry}`;
      }
    });
    return { success: true, output: details.join('\n') };
  } catch (error) {
    return { success: false, output: `Failed to list directory: ${(error as Error).message}`, error: 'LIST_ERROR' };
  }
}

export async function folderMove(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const source = resolve(context.scopePath, args['from'] as string);
  const destination = resolve(context.scopePath, args['to'] as string);
  try {
    if (!existsSync(source)) {
      return { success: false, output: 'Source does not exist', error: 'NOT_FOUND' };
    }
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
    return { success: true, output: `Moved ${source} → ${destination}` };
  } catch (error) {
    return { success: false, output: `Failed to move: ${(error as Error).message}`, error: 'MOVE_ERROR' };
  }
}

export async function fileFind(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const searchPath = (args['path'] as string) ?? '.';
  const cwd = resolve(context.scopePath, searchPath);

  try {
    const cmd = IS_WINDOWS
      ? `dir /s /b "${pattern}" 2>nul | findstr /v node_modules | findstr /v .git | findstr /v dist`
      : `find . -name "${pattern.replace(/"/g, '\\"')}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -100`;
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 });
    const files = output.trim().split('\n').filter(Boolean);
    if (files.length === 0) {
      return { success: true, output: 'No files matched' };
    }
    return { success: true, output: files.join('\n'), metadata: { count: files.length } };
  } catch {
    return { success: true, output: 'No files matched' };
  }
}
