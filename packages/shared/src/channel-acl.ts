/** True when messaging channels must have an explicit allowlist configured. */
export function isChannelAllowlistRequired(): boolean {
  return process.env['AGENTX_REQUIRE_CHANNEL_ALLOWLIST'] === 'true'
    || process.env['AGENTX_MODE'] === 'server'
    || process.env['AGENTX_SERVER_MODE'] === '1';
}

export function parseAllowedUserIds(raw?: string | string[]): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

export function isChannelUserAllowed(userId: string, allowedUserIds?: string[]): boolean {
  const ids = allowedUserIds ?? [];
  if (ids.length === 0) {
    return !isChannelAllowlistRequired();
  }
  return ids.includes(String(userId));
}
