import * as vscode from 'vscode';

export type VSCodeErrorCode =
  | 'AUTH_FAILED'
  | 'CONFIG_MISSING'
  | 'PROVIDER_UNREACHABLE'
  | 'RATE_LIMITED'
  | 'CONTEXT_OVERFLOW'
  | 'TOOL_EXECUTION_FAILED'
  | 'WORKSPACE_REQUIRED'
  | 'ENGINE_CRASHED'
  | 'UNKNOWN';

export interface VSCodeError {
  code: VSCodeErrorCode;
  message: string;
  detail: string;
  recoverable: boolean;
  actions?: Array<{ label: string; command: string; args?: unknown[] }>;
}

export function classifyEngineError(err: unknown, _context: vscode.ExtensionContext): VSCodeError {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('API key') || msg.includes('auth') || msg.includes('401') || msg.includes('403')) {
    return {
      code: 'AUTH_FAILED',
      message: 'Authentication failed',
      detail: msg,
      recoverable: true,
      actions: [
        { label: 'Configure API Key', command: 'agentx.configureProvider' },
      ],
    };
  }

  if (msg.includes('config') || msg.includes('not configured') || msg.includes('setup')) {
    return {
      code: 'CONFIG_MISSING',
      message: 'Configuration required',
      detail: msg,
      recoverable: true,
      actions: [
        { label: 'Run Setup Wizard', command: 'agentx.firstRun' },
      ],
    };
  }

  if (msg.includes('timeout') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
    return {
      code: 'PROVIDER_UNREACHABLE',
      message: 'Provider unreachable',
      detail: msg,
      recoverable: true,
      actions: [
        { label: 'Switch Provider', command: 'agentx.switchProvider' },
      ],
    };
  }

  if (msg.includes('rate') || msg.includes('429') || msg.includes('too many')) {
    return {
      code: 'RATE_LIMITED',
      message: 'Rate limited by provider',
      detail: msg,
      recoverable: true,
    };
  }

  if (msg.includes('context') || msg.includes('token')) {
    return {
      code: 'CONTEXT_OVERFLOW',
      message: 'Context window exceeded',
      detail: msg,
      recoverable: true,
    };
  }

  return {
    code: 'UNKNOWN',
    message: 'An unexpected error occurred',
    detail: msg,
    recoverable: false,
  };
}
