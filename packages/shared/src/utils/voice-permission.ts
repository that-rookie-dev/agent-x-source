/** How long the voice/crew-call permission modal waits before auto-cancelling. */
export const VOICE_PERMISSION_TIMEOUT_MS = 10_000;

/** Honest tool-result instruction when the user ignores the permission prompt. */
export const VOICE_PERMISSION_TIMEOUT_INSTRUCTION =
  'Permission request timed out after 10 seconds with no user response. '
  + 'The tool action was NOT performed. Do not claim it succeeded — '
  + 'ask the user to approve again if the action is still needed.';
