/**
 * Agent-X Space-Themed Error Messages.
 * Maps HTTP codes and error categories to in-universe copy.
 * No raw technical text should ever reach the user.
 */

export interface SpaceError {
  title: string;
  message: string;
  icon: string;
}

/** HTTP status code → space-themed error */
export const HTTP_ERROR_MAP: Record<number, SpaceError> = {
  400: {
    title: 'Malformed Transmission',
    icon: '📡',
    message: 'The request was garbled in transit. Try rephrasing your message.',
  },
  401: {
    title: 'Clearance Denied',
    icon: '🔐',
    message: 'Your access credentials have expired or are invalid. Reconfigure your API key.',
  },
  402: {
    title: 'Fuel Depleted',
    icon: '⛽',
    message: 'Your provider account has run out of credits. Top up or switch providers.',
  },
  403: {
    title: 'Restricted Sector',
    icon: '🚫',
    message: 'Access denied by the provider. Check your permissions or billing status.',
  },
  404: {
    title: 'Signal Lost',
    icon: '📡',
    message: 'The requested model or endpoint was not found. It may have been decommissioned.',
  },
  429: {
    title: 'Traffic Congestion',
    icon: '🚦',
    message: 'Too many requests. The lanes are jammed — wait a moment and try again.',
  },
  500: {
    title: 'Station Malfunction',
    icon: '🛠',
    message: 'The AI provider is experiencing internal issues. Try again shortly.',
  },
  502: {
    title: 'Relay Offline',
    icon: '📡',
    message: 'Bad gateway — the relay station is unresponsive. Try again in a moment.',
  },
  503: {
    title: 'Station Overloaded',
    icon: '⚠️',
    message: 'The provider is temporarily unavailable. Systems are at capacity.',
  },
  504: {
    title: 'Transmission Timeout',
    icon: '⏱',
    message: 'The provider took too long to respond. Try again or switch models.',
  },
};

/** Category-based error mapping for non-HTTP errors */
export const ERROR_CATEGORY_MAP: Record<string, SpaceError> = {
  network: {
    title: 'Comms Offline',
    icon: '📡',
    message: 'Unable to reach mission control. Check your internet connection.',
  },
  timeout: {
    title: 'Transmission Timeout',
    icon: '⏱',
    message: 'The signal timed out before a response arrived. Try again.',
  },
  auth: {
    title: 'Clearance Denied',
    icon: '🔐',
    message: 'Authentication failed. Your API key may be invalid or expired.',
  },
  rate_limit: {
    title: 'Traffic Congestion',
    icon: '🚦',
    message: 'Rate limited. Wait a moment before retrying.',
  },
  model_unavailable: {
    title: 'Model Grounded',
    icon: '🛬',
    message: 'This model is currently unavailable. Select a different one.',
  },
  no_models: {
    title: 'Hangar Empty',
    icon: '🏚',
    message: 'No models found. Verify your API key has the correct permissions.',
  },
  config_corrupt: {
    title: 'Navigation Data Corrupted',
    icon: '💾',
    message: 'Configuration file is damaged. Restoring from last known good state.',
  },
  crash_recovery: {
    title: 'Emergency Reboot',
    icon: '🔄',
    message: 'Agent-X recovered from an unexpected shutdown. Your settings have been restored.',
  },
  validation_failed: {
    title: 'Pre-flight Check Failed',
    icon: '❌',
    message: 'The API key could not be validated. Double-check and try again.',
  },
  unknown: {
    title: 'Anomaly Detected',
    icon: '🌀',
    message: 'Something unexpected happened. Please try again.',
  },
};

/**
 * Resolve an error into a space-themed user-facing message.
 * Parses HTTP status codes from error messages when possible.
 */
export function resolveSpaceError(error: unknown): SpaceError {
  const msg = error instanceof Error ? error.message : String(error);

  // Try to extract HTTP status code
  const statusMatch = msg.match(/\b([45]\d{2})\b/);
  if (statusMatch) {
    const code = parseInt(statusMatch[1]!, 10);
    if (HTTP_ERROR_MAP[code]) return HTTP_ERROR_MAP[code]!;
  }

  // Category detection from error message patterns
  if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ENETUNREACH')) {
    return ERROR_CATEGORY_MAP['network']!;
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout') || msg.includes('AbortError')) {
    return ERROR_CATEGORY_MAP['timeout']!;
  }
  if (msg.includes('Unauthorized') || msg.includes('Invalid API') || msg.includes('invalid_api_key')) {
    return ERROR_CATEGORY_MAP['auth']!;
  }
  if (msg.includes('rate limit') || msg.includes('Too Many Requests')) {
    return ERROR_CATEGORY_MAP['rate_limit']!;
  }

  return ERROR_CATEGORY_MAP['unknown']!;
}
