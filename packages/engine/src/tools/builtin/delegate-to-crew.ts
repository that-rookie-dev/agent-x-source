import type { ToolResult } from '../ToolExecutor.js';

let crewDelegator: ((crewName: string, taskDescription: string) => Promise<string>) | null = null;

export function setCrewDelegator(fn: NonNullable<typeof crewDelegator>): void {
  crewDelegator = fn;
}

export async function delegateToCrew(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const crewName = args['crew'] as string | undefined;
  const task = args['task'] as string | undefined;

  if (!crewName || !task) {
    return { success: false, output: 'Both crew name and task description are required', error: 'MISSING_PARAMS' };
  }

  if (!crewDelegator) {
    return { success: false, output: 'Crew delegation not available (no agent initialized)', error: 'NOT_CONFIGURED' };
  }

  try {
    const result = await crewDelegator(crewName, task);
    return { success: true, output: result };
  } catch (err) {
    return { success: false, output: `Crew delegation failed: ${err instanceof Error ? err.message : String(err)}`, error: 'CREW_ERROR' };
  }
}
