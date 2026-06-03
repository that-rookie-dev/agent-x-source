import * as vscode from 'vscode';

let testController: vscode.TestController | null = null;

export function registerTestController(context: vscode.ExtensionContext): void {
  testController = vscode.tests.createTestController('agentx', 'Agent-X Tests');
  context.subscriptions.push(testController);
}

export function publishTestResults(
  results: Array<{
    testName: string;
    passed: boolean;
    duration?: number;
    message?: string;
    file?: string;
    line?: number;
  }>,
): void {
  if (!testController) return;

  for (const result of results) {
    const item = testController.createTestItem(result.testName, result.testName, result.file ? vscode.Uri.file(result.file) : undefined);
    if (result.line) item.range = new vscode.Range(result.line - 1, 0, result.line - 1, 0);

    const run = testController.createTestRun(new vscode.TestRunRequest());
    run.enqueued(item);
    if (result.passed) {
      run.passed(item, result.duration);
    } else {
      run.failed(item, result.message ? [new vscode.TestMessage(result.message)] : [], result.duration);
    }
    run.end();
  }
}

export function clearTestResults(): void {
  testController?.items.replace([]);
}
