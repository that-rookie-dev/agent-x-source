/**
 * Thin re-export aggregator — preserves the public API so all existing
 * imports from `./channels-sync.js` continue to work.
 *
 * Implementation split into domain-specific modules under `./channels/`:
 *   - channels/shared.ts   — shared helpers + runtime state
 *   - channels/telegram.ts — Telegram discovery, lifecycle, persistence, greetings
 *   - channels/slack.ts    — Slack inbound lifecycle
 *   - channels/discord.ts  — Discord inbound lifecycle
 *   - channels/config.ts   — applyChannelsConfig() orchestrator
 */
export * from './channels/shared.js';
export * from './channels/telegram.js';
export * from './channels/slack.js';
export * from './channels/discord.js';
export * from './channels/config.js';
