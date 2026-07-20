import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn(),
  ensureChannelAgent: vi.fn(),
  rewireTelegramChannelPermissions: vi.fn(),
  syncChannelSuperSessionContext: vi.fn(),
}));

vi.mock('@agentx/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentx/shared')>();
  return {
    ...actual,
    getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  };
});

import { getEngine } from '../src/engine.js';
import {
  isTelegramOutboundReady,
  isTelegramInboundReady,
  getTelegramInboundStatus,
  getTelegramRuntimeHints,
  discoverTelegramBot,
} from '../src/channels-sync.js';

describe('isTelegramOutboundReady', () => {
  it('returns false when not enabled', () => {
    expect(isTelegramOutboundReady({ enabled: false })).toBe(false);
  });

  it('returns false when enabled but no bot token', () => {
    expect(isTelegramOutboundReady({ enabled: true, outbound: true, chatId: '123' })).toBe(false);
  });

  it('returns false when enabled with token but no chatId', () => {
    expect(isTelegramOutboundReady({ enabled: true, outbound: true, botToken: 'token' })).toBe(false);
  });

  it('returns true when enabled with token and chatId', () => {
    expect(isTelegramOutboundReady({ enabled: true, outbound: true, botToken: 'token', chatId: '123' })).toBe(true);
  });

  it('returns false when outbound is explicitly disabled', () => {
    expect(isTelegramOutboundReady({ enabled: true, outbound: false, botToken: 'token', chatId: '123' })).toBe(false);
  });

  it('uses env TELEGRAM_BOT_TOKEN as fallback', () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'env-token';
    expect(isTelegramOutboundReady({ enabled: true, outbound: true, chatId: '123' })).toBe(true);
    delete process.env['TELEGRAM_BOT_TOKEN'];
  });
});

describe('isTelegramInboundReady', () => {
  it('returns false when not enabled', () => {
    expect(isTelegramInboundReady({ enabled: false })).toBe(false);
  });

  it('returns false when enabled but no bot token', () => {
    expect(isTelegramInboundReady({ enabled: true, inbound: true })).toBe(false);
  });

  it('returns false when inbound is explicitly disabled', () => {
    expect(isTelegramInboundReady({ enabled: true, inbound: false, botToken: 'token' })).toBe(false);
  });

  it('returns true when enabled with token and allowedUserIds', () => {
    expect(isTelegramInboundReady({ enabled: true, inbound: true, botToken: 'token', allowedUserIds: '12345' })).toBe(true);
  });

  it('returns true when enabled with token and private chatId', () => {
    expect(isTelegramInboundReady({ enabled: true, inbound: true, botToken: 'token', chatId: '12345' })).toBe(true);
  });

  it('returns false when chatId is a group (starts with -)', () => {
    expect(isTelegramInboundReady({ enabled: true, inbound: true, botToken: 'token', chatId: '-100123' })).toBe(false);
  });

  it('uses env TELEGRAM_BOT_TOKEN as fallback', () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'env-token';
    expect(isTelegramInboundReady({ enabled: true, inbound: true, chatId: '12345' })).toBe(true);
    delete process.env['TELEGRAM_BOT_TOKEN'];
  });
});

describe('getTelegramInboundStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns not-ready status when config load throws', () => {
    (getEngine as any).mockReturnValue({
      configManager: { load: () => { throw new Error('not configured'); } },
      telegramBridge: null,
      gateway: null,
      channelAgent: null,
    });

    const status = getTelegramInboundStatus();
    expect(status.bridgeRunning).toBe(false);
    expect(status.savedEnabled).toBe(false);
    expect(status.hasBotToken).toBe(false);
    expect(status.inboundReady).toBe(false);
  });

  it('returns status with bridge running', () => {
    (getEngine as any).mockReturnValue({
      configManager: {
        load: () => ({
          channels: {
            telegram: { enabled: true, inbound: true, botToken: 'token', chatId: '123', allowedUserIds: '456' },
          },
        }),
      },
      telegramBridge: { isRunning: () => true, getStatus: () => ({ botUsername: 'mybot' }) },
      gateway: null,
      channelAgent: { currentSessionId: 'sess1' },
    });

    const status = getTelegramInboundStatus();
    expect(status.bridgeRunning).toBe(true);
    expect(status.botUsername).toBe('mybot');
    expect(status.savedEnabled).toBe(true);
    expect(status.hasBotToken).toBe(true);
    expect(status.inboundReady).toBe(true);
    expect(status.channelAgentAttached).toBe(false);
    expect(status.channelSessionId).toBe('sess1');
  });

  it('returns status with saved chatId', () => {
    (getEngine as any).mockReturnValue({
      configManager: {
        load: () => ({
          channels: {
            telegram: { enabled: true, inbound: true, botToken: 'token', chatId: '789' },
          },
        }),
      },
      telegramBridge: null,
      gateway: null,
      channelAgent: null,
    });

    const status = getTelegramInboundStatus();
    expect(status.savedChatId).toBe('789');
    expect(status.savedEnabled).toBe(true);
  });
});

describe('getTelegramRuntimeHints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object when engine throws', () => {
    (getEngine as any).mockImplementation(() => { throw new Error('no engine'); });
    expect(getTelegramRuntimeHints()).toEqual({});
  });

  it('returns telegramChatId from config', () => {
    (getEngine as any).mockReturnValue({
      configManager: {
        load: () => ({
          channels: { telegram: { chatId: '12345' } },
        }),
      },
      gateway: null,
    });

    const hints = getTelegramRuntimeHints();
    expect(hints.telegramChatId).toBe('12345');
  });

  it('returns empty object when no chatId in config', () => {
    (getEngine as any).mockReturnValue({
      configManager: { load: () => ({ channels: {} }) },
      gateway: null,
    });

    expect(getTelegramRuntimeHints()).toEqual({});
  });
});

describe('discoverTelegramBot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error when token is empty', async () => {
    const result = await discoverTelegramBot('');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns error when token is whitespace', async () => {
    const result = await discoverTelegramBot('   ');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns error when fetch fails', async () => {
    const result = await discoverTelegramBot('invalid-token');
    expect(result.ok).toBe(false);
  });
});
