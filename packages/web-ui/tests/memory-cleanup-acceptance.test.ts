import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const uiSrc = join(import.meta.dirname, '../src');

function readUi(relativePath: string): string {
  return readFileSync(join(uiSrc, relativePath), 'utf-8');
}

describe('memory cleanup UI acceptance (Phase B/D/G)', () => {
  it('DockingStation has no vitals card or polling', () => {
    const source = readUi('pages/DockingStation.tsx');
    expect(source).not.toMatch(/\bvitals\b/i);
    expect(source).not.toContain('AgentVitals');
  });

  it('Console has no Soul panel wiring', () => {
    const source = readUi('pages/Console.tsx');
    expect(source).not.toContain('SoulPanel');
    expect(source).not.toMatch(/['"]soul['"]/);
  });

  it('api client has no secret-sauce or vitals endpoints', () => {
    const source = readUi('api.ts');
    expect(source).not.toContain('secretSauce');
    expect(source).not.toContain('SecretSauceFile');
    expect(source).not.toMatch(/vitals\s*\(/);
  });

  it('Sidebar has no soul nav entry', () => {
    const source = readUi('components/Sidebar.tsx');
    expect(source).not.toMatch(/id:\s*['"]soul['"]/);
  });
});
