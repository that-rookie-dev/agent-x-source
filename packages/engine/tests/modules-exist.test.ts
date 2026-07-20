import { describe, it, expect } from 'vitest';

describe('ConfigManager', () => {
  it('module can be imported', async () => {
    const { ConfigManager } = await import('../src/config/ConfigManager.js');
    expect(ConfigManager).toBeDefined();
  });
});

describe('CrewManager', () => {
  it('module can be imported', async () => {
    const { CrewManager } = await import('../src/crew/CrewManager.js');
    expect(CrewManager).toBeDefined();
  });
});

describe('EnhancedToolExecutor', () => {
  it('module can be imported', async () => {
    const { EnhancedToolExecutor } = await import('../src/tools/EnhancedToolExecutor.js');
    expect(EnhancedToolExecutor).toBeDefined();
  });
});
