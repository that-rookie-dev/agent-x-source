import * as vscode from 'vscode';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('agentx');

export function clearDiagnostics(): void {
  diagnosticCollection.clear();
}

export function applyLintResults(
  uri: vscode.Uri,
  results: Array<{ line: number; column: number; message: string; severity: 'error' | 'warning' | 'info' }>,
): void {
  const diagnostics: vscode.Diagnostic[] = results.map((r) => {
    const range = new vscode.Range(
      Math.max(0, r.line - 1), Math.max(0, r.column - 1),
      Math.max(0, r.line - 1), r.column + 100,
    );
    const severityMap: Record<string, vscode.DiagnosticSeverity> = {
      error: vscode.DiagnosticSeverity.Error,
      warning: vscode.DiagnosticSeverity.Warning,
      info: vscode.DiagnosticSeverity.Information,
    };
    return new vscode.Diagnostic(range, r.message, severityMap[r.severity] ?? vscode.DiagnosticSeverity.Error);
  });

  diagnosticCollection.set(uri, diagnostics);
}

export function disposeDiagnostics(): void {
  diagnosticCollection.dispose();
}
