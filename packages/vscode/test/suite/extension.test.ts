import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension Activation', () => {
  test('should be present in extensions', () => {
    const ext = vscode.extensions.getExtension('slashpan.agentx');
    assert.ok(ext, 'Extension should be found');
  });

  test('should activate', async () => {
    const ext = vscode.extensions.getExtension('slashpan.agentx');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    assert.ok(ext?.isActive, 'Extension should be active');
  });

  test('should register agentx.openChat command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('agentx.openChat'),
      'agentx.openChat command should be registered',
    );
  });
});
