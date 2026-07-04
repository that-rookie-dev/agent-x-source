/** Internal session id for one automation task's run history (not a user chat session). */
export function automationRunSessionId(taskId: string): string {
  return `automation:${taskId}`;
}

export function isAutomationSessionId(id: string): boolean {
  return id.startsWith('automation:');
}

export function automationTaskIdFromSessionId(sessionId: string): string | null {
  return isAutomationSessionId(sessionId) ? sessionId.slice('automation:'.length) : null;
}

/** Sessions shown in the chat sidebar / search — excludes internal system runs. */
export function isUserFacingSession(session: {
  id: string;
  parentId?: string | null;
  contextKind?: string;
}): boolean {
  if (!session.id || session.id === '__channel__') return false;
  if (session.parentId) return false;
  if (session.contextKind === 'automation') return false;
  if (isAutomationSessionId(session.id)) return false;
  return true;
}
