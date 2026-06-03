import * as vscode from 'vscode';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolResult } from '@agentx/shared';
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
      await vscode.workspace.openTextDocument(uri);

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
    const filePath = (args['path'] ?? args['file']) as string | undefined;

    try {
      const uris = filePath
        ? [vscode.Uri.file(resolve(ws, filePath))]
        : (await vscode.workspace.findFiles(
            new vscode.RelativePattern(ws, '**/*.{ts,tsx,js,jsx,mjs,cjs}'),
            '**/node_modules/**',
            20,
          ));

      const refs: Array<{ file: string; line: number; column: number }> = [];
      for (const uri of uris) {
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          for (let i = 0; i < doc.lineCount; i++) {
            const col = doc.lineAt(i).text.indexOf(symbol);
            if (col === -1) continue;
            const pos = new vscode.Position(i, col);
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
              'vscode.executeReferenceProvider',
              uri,
              pos,
            );
            if (!locations) continue;
            for (const loc of locations) {
              const rel = loc.uri.fsPath.replace(ws + '/', '');
              refs.push({ file: rel, line: loc.range.start.line + 1, column: loc.range.start.character + 1 });
              if (refs.length >= 50) break;
            }
            if (refs.length >= 50) break;
          }
        } catch { continue; }
        if (refs.length >= 50) break;
      }

      const output = refs.map((r) => `${r.file}:${r.line}:${r.column}`).join('\n');
      return {
        success: true,
        output: output || `No references found for "${symbol}"`,
        metadata: { symbol, count: refs.length },
      };
    } catch {
      return { success: true, output: `No references found for "${symbol}"` };
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
