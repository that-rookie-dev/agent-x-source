import { system } from '../api';

/** Resolve Agent-X default workspace (Desktop). Uses Electron path on desktop. */
export async function resolveDefaultWorkspace(): Promise<string> {
  if (typeof window !== 'undefined' && window.agentx?.defaultWorkspace) {
    const path = await window.agentx.defaultWorkspace();
    if (path) return path;
  }
  const { path } = await system.defaultWorkspace();
  return path;
}
