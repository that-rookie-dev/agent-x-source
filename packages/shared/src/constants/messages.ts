/**
 * Agent-X Space Theme — Centralized messages & copy strings.
 * All user-facing text follows the space/aviation theme.
 */

export const TAGLINE = 'Your AI Wingman';

/** Loading/thinking gimmick messages — shown while waiting for LLM response */
export const GIMMICK_MESSAGES = [
  'Plotting trajectory...',
  'Scanning star charts...',
  'Engaging warp drive...',
  'Querying the cosmic database...',
  'Decoding transmissions...',
  'Consulting the nebula...',
  'Aligning satellites...',
  'Traversing the code galaxy...',
  'Docking at the answer station...',
  'Parsing interstellar data...',
  'Calibrating warp field...',
  'Navigating the asteroid belt...',
  'Receiving deep space signal...',
  'Charging photon cannons...',
  'Syncing with mission control...',
] as const;

/** Status messages for different events */
export const STATUS_MESSAGES = {
  processingStart: 'Engaging thrusters...',
  toolExecuting: (tool: string) => `Deploying probe: ${tool}`,
  toolComplete: (tool: string) => `Probe returned: ${tool} ✓`,
  toolError: (tool: string) => `Probe lost: ${tool} ✗`,
  agentSpawned: 'Launched satellite agent',
  agentComplete: 'Satellite docked ✓',
  agentFailed: 'Satellite lost signal ✗',
  permissionRequired: '🔐 Clearance Required',
  sessionEnd: 'Entering cryo-sleep. See you, commander.',
  errorPrefix: 'Anomaly detected',
  scheduledJob: 'Orbital ping received',
  backgrounded: 'Task moved to orbit',
  starting: 'Booting systems...',
} as const;

/** Reasoning/thinking display framing */
export const REASONING = {
  prefix: '「',
  suffix: '」',
  activeLabel: 'deep space thought',
  completeLabel: 'transmission complete',
} as const;

/** Installer messages (used by install.sh via reference) */
export const INSTALLER_MESSAGES = [
  'Running pre-flight diagnostics...',
  'Downloading payload from orbit...',
  'Assembling quantum modules...',
  'Calibrating neural pathways...',
  'Locking navigation coordinates...',
] as const;
