import { integrations } from '../../api';

export function outputLooksSignedIn(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.loggedIn === true || parsed.logged_in === true || parsed.authenticated === true || parsed.signedIn === true) {
        return true;
      }
      if (parsed.success === true && parsed.loggedIn !== false && parsed.logged_in !== false) {
        return true;
      }
      const status = String(parsed.status ?? '').toLowerCase();
      if (status === 'logged_in' || status === 'authenticated' || status === 'signed_in') {
        return true;
      }
    } catch {
      /* fall through to text heuristics */
    }
  }

  const lower = output.toLowerCase();
  return (
    (lower.includes('logged in') || lower.includes('authenticated') || lower.includes('signed in'))
    && !lower.includes('not connected')
    && !lower.includes('not logged')
  );
}

export function outputLooksFailed(output: string): boolean {
  const trimmed = output.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.loggedIn === false || parsed.logged_in === false) return true;
      if (parsed.success === false) return true;
      const status = String(parsed.status ?? '').toLowerCase();
      if (status === 'failed' || status === 'error') return true;
    } catch {
      /* fall through */
    }
  }
  const lower = output.toLowerCase();
  return lower.includes('failed') || (lower.includes('error') && !lower.includes('no error'));
}

export function isNotConnectedResult(result: { success: boolean; error?: string; output?: string }): boolean {
  return result.error === 'NOT_CONNECTED' || (result.output ?? '').toLowerCase().includes('not connected');
}

export async function checkPackageSignInStatus(connectionId: string, statusTool: string): Promise<boolean> {
  const { result } = await integrations.runTool(connectionId, statusTool);
  if (isNotConnectedResult(result)) return false;
  return outputLooksSignedIn(result.output ?? '');
}
