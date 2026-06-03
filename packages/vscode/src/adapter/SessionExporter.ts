import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EngineLifecycle } from './EngineLifecycle';
import type { ChatMessage } from './types';
import type { SessionPersistence } from './SessionPersistence';

type ExportFormat = 'json' | 'markdown' | 'jsonl';

interface ExportPayload {
  sessionId: string;
  title: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  contextText: string;
  checkpointIds: string[];
}

export class SessionExporter {
  constructor(
    private readonly engineLifecycle: EngineLifecycle,
    private readonly persistence: SessionPersistence,
  ) {}

  async exportSession(sessionId: string): Promise<void> {
    const formatChoice = await vscode.window.showQuickPick(
      [
        { label: 'JSON', description: 'Full trajectory with messages, context, checkpoints', format: 'json' as ExportFormat },
        { label: 'Markdown', description: 'Human-readable conversation format', format: 'markdown' as ExportFormat },
        { label: 'JSONL', description: 'One message per line, for fine-tuning', format: 'jsonl' as ExportFormat },
      ],
      { placeHolder: 'Select export format' },
    );

    if (!formatChoice) return;

    const payload = await this.buildPayload(sessionId);
    if (!payload) return;

    const content = this.formatPayload(payload, formatChoice.format);

    const action = await vscode.window.showQuickPick(
      [
        { label: 'Save to File', action: 'file' },
        { label: 'Copy to Clipboard', action: 'clipboard' },
      ],
      { placeHolder: 'How would you like to export?' },
    );

    if (!action) return;

    if (action.action === 'clipboard') {
      await vscode.env.clipboard.writeText(content);
      vscode.window.showInformationMessage(`Session exported to clipboard (${formatChoice.label}).`);
    } else {
      await this.saveToFile(payload, formatChoice.format, content);
    }
  }

  private async buildPayload(sessionId: string): Promise<ExportPayload | null> {
    const sessions = await this.engineLifecycle.listSessions();
    const found = sessions.find((s) => s.id === sessionId);

    const messages = this.persistence.loadMessages(sessionId);

    const sessionDir = this.persistence.getSessionDir(sessionId);
    const contextPath = path.join(sessionDir, 'context.txt');
    let contextText = '';
    try {
      if (fs.existsSync(contextPath)) {
        contextText = fs.readFileSync(contextPath, 'utf-8');
      }
    } catch {
      contextText = '';
    }

    const checkpointsDir = path.join(sessionDir, 'checkpoints');
    let checkpointIds: string[] = [];
    try {
      if (fs.existsSync(checkpointsDir)) {
        checkpointIds = fs.readdirSync(checkpointsDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace('.json', ''));
      }
    } catch {
      checkpointIds = [];
    }

    return {
      sessionId,
      title: found?.title || 'New Session',
      providerId: found?.providerId || '',
      modelId: found?.modelId || '',
      createdAt: found?.createdAt || '',
      updatedAt: found?.updatedAt || '',
      messages,
      contextText,
      checkpointIds,
    };
  }

  formatPayload(payload: ExportPayload, format: ExportFormat): string {
    switch (format) {
      case 'json':
        return this.formatJson(payload);
      case 'markdown':
        return this.formatMarkdown(payload);
      case 'jsonl':
        return this.formatJsonl(payload);
    }
  }

  private formatJson(payload: ExportPayload): string {
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      session: {
        id: payload.sessionId,
        title: payload.title,
        provider: payload.providerId,
        model: payload.modelId,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
      },
      messages: payload.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tokenCount: m.tokenCount,
        createdAt: m.createdAt,
        toolCalls: m.toolCalls,
        reasoning: m.reasoning,
      })),
      context: payload.contextText,
      checkpoints: payload.checkpointIds,
    };
    return JSON.stringify(exportData, null, 2);
  }

  private formatMarkdown(payload: ExportPayload): string {
    const lines: string[] = [];
    lines.push(`# ${payload.title}`);
    lines.push('');
    lines.push(`- **Session ID**: \`${payload.sessionId}\``);
    lines.push(`- **Provider**: ${payload.providerId}`);
    lines.push(`- **Model**: ${payload.modelId}`);
    lines.push(`- **Created**: ${new Date(payload.createdAt).toLocaleString()}`);
    lines.push(`- **Updated**: ${new Date(payload.updatedAt).toLocaleString()}`);
    lines.push(`- **Messages**: ${payload.messages.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of payload.messages) {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      const time = new Date(msg.createdAt).toLocaleTimeString();
      lines.push(`## ${role} — ${time}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push('### Tool Calls');
        lines.push('');
        for (const tc of msg.toolCalls) {
          lines.push(`- **${tc.name}**: \`${tc.arguments}\``);
          if (tc.result) {
            lines.push('');
            lines.push('```');
            lines.push(tc.result);
            lines.push('```');
          }
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    if (payload.checkpointIds.length > 0) {
      lines.push('## Checkpoints');
      lines.push('');
      for (const cpId of payload.checkpointIds) {
        lines.push(`- \`${cpId}\``);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatJsonl(payload: ExportPayload): string {
    const lines: string[] = [];
    for (const msg of payload.messages) {
      const record = {
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt,
        tokenCount: msg.tokenCount,
      };
      lines.push(JSON.stringify(record));
    }
    return lines.join('\n');
  }

  private async saveToFile(payload: ExportPayload, format: ExportFormat, content: string): Promise<void> {
    const ext = format === 'jsonl' ? 'jsonl' : format === 'markdown' ? 'md' : 'json';
    const defaultName = (payload.title || 'session').replace(/[^a-zA-Z0-9_-]/g, '_');

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${defaultName}.${ext}`),
      filters: {
        [format.toUpperCase()]: [ext],
      },
    });

    if (!uri) return;

    fs.writeFileSync(uri.fsPath, content, 'utf-8');
    vscode.window.showInformationMessage(`Session exported to ${uri.fsPath}`);
  }
}
