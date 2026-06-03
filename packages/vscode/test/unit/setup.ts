import { vi } from 'vitest';

vi.mock('vscode', () => {
  return require('./__mocks__/vscode');
});

process.env.NODE_ENV = 'test';
process.env.AGENTX_TEST = '1';
