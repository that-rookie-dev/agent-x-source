import { VSCodeEngine } from './adapter/VSCodeEngine';
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';

const engineInstances = new Map<string, VSCodeEngine>();

function instanceKey(context: vscode.ExtensionContext): string {
  return crypto.createHash('sha256').update(context.extensionUri.fsPath).digest('hex');
}

export function getEngineInstance(context: vscode.ExtensionContext): VSCodeEngine | undefined {
  return engineInstances.get(instanceKey(context));
}

export function setEngineInstance(context: vscode.ExtensionContext, engine: VSCodeEngine): void {
  engineInstances.set(instanceKey(context), engine);
}

export function deleteEngineInstance(context: vscode.ExtensionContext): void {
  engineInstances.delete(instanceKey(context));
}
