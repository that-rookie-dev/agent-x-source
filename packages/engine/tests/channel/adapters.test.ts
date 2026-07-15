import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordBridgeAdapter } from '../../src/services/channel/adapters/DiscordBridgeAdapter.js';
import { SlackBridgeAdapter } from '../../src/services/channel/adapters/SlackBridgeAdapter.js';
import { EmailBridgeAdapter } from '../../src/services/channel/adapters/EmailBridgeAdapter.js';
import { TelegramBridgeAdapter } from '../../src/services/channel/adapters/TelegramBridgeAdapter.js';
import type { OnInboundCallback } from '../../src/services/channel/IChannelBridge.js';

function makeMockDiscordBridge() {
  return {
    setAllowedUserIds: vi.fn(),
    setMessageHandler: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(() => ({
      connected: true, botUsername: 'testbot', guilds: 2, messageCount: 5,
    })),
  };
}

function makeMockSlackBridge() {
  return {
    setAllowedUserIds: vi.fn(),
    setMessageHandler: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(() => ({
      configured: true, connected: true, team: 'test-team',
    })),
  };
}

function makeMockEmailBridge() {
  return {
    setMessageHandler: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendEmail: vi.fn().mockResolvedValue(undefined),
    replyTo: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(() => ({
      connected: true, configured: true, unreadCount: 3,
      smtpConnected: true, imapConnected: true, lastError: undefined,
    })),
  };
}

function makeMockTelegramBridge() {
  return {
    attach: vi.fn(),
    setMessageHandler: vi.fn(),
    setFileHandler: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getLastFromId: vi.fn(() => 12345),
    getStatus: vi.fn(() => ({
      connected: true, botUsername: 'testbot', lastActivity: '2024-01-01T00:00:00Z', messageCount: 10,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DiscordBridgeAdapter', () => {
  it('initializes with default config when no options provided', () => {
    const adapter = new DiscordBridgeAdapter();
    const status = adapter.getStatus();
    expect(status.channel).toBe('discord');
    expect(status.connected).toBe(false);
  });

  it('start sets allowed users, message handler, and starts bridge', async () => {
    const bridge = makeMockDiscordBridge();
    const adapter = new DiscordBridgeAdapter({
      bridge: bridge as any,
      discordConfig: { botToken: 'token', channelId: 'chan' },
      allowedUserIds: ['u1', 'u2'],
    });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    expect(bridge.setAllowedUserIds).toHaveBeenCalledWith(['u1', 'u2']);
    expect(bridge.setMessageHandler).toHaveBeenCalledOnce();
    expect(bridge.start).toHaveBeenCalledWith('token', 'chan');
  });

  it('message handler invokes onInbound with discord channel', async () => {
    const bridge = makeMockDiscordBridge();
    const adapter = new DiscordBridgeAdapter({ bridge: bridge as any, discordConfig: { botToken: 't' } });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    const handler = bridge.setMessageHandler.mock.calls[0]![0];
    handler('hello', 'user1', 'channel1');

    expect(onInbound).toHaveBeenCalledWith('discord', expect.objectContaining({
      channel: 'discord',
      sender: { id: 'user1', name: 'unknown' },
      text: 'hello',
      threadId: 'channel1',
    }));
  });

  it('send sends message to threadId channel', async () => {
    const bridge = makeMockDiscordBridge();
    const adapter = new DiscordBridgeAdapter({ bridge: bridge as any, discordConfig: { botToken: 't' } });

    await adapter.send({ text: 'hi', threadId: 'chan123' });
    expect(bridge.sendMessage).toHaveBeenCalledWith('chan123', 'hi');
  });

  it('send falls back to config channelId when no threadId', async () => {
    const bridge = makeMockDiscordBridge();
    const adapter = new DiscordBridgeAdapter({ bridge: bridge as any, discordConfig: { botToken: 't', channelId: 'default-chan' } });

    await adapter.send({ text: 'hi' });
    expect(bridge.sendMessage).toHaveBeenCalledWith('default-chan', 'hi');
  });

  it('send throws when no channel id available', async () => {
    const bridge = makeMockDiscordBridge();
    const adapter = new DiscordBridgeAdapter({ bridge: bridge as any, discordConfig: { botToken: 't' } });

    await expect(adapter.send({ text: 'hi' })).rejects.toThrow('Discord channel id is required');
  });

  it('stop calls bridge.stop', async () => {
    const bridge = makeMockDiscordBridge();
    const adapter = new DiscordBridgeAdapter({ bridge: bridge as any });

    await adapter.stop();
    expect(bridge.stop).toHaveBeenCalledOnce();
  });

  it('getStatus returns normalized status', () => {
    const bridge = makeMockDiscordBridge();
    const adapter = new DiscordBridgeAdapter({ bridge: bridge as any });

    const status = adapter.getStatus();
    expect(status.channel).toBe('discord');
    expect(status.connected).toBe(true);
    expect(status.details).toEqual({ botUsername: 'testbot', guilds: 2, messageCount: 5 });
  });
});

describe('SlackBridgeAdapter', () => {
  it('initializes with default config when no options provided', () => {
    const adapter = new SlackBridgeAdapter();
    const status = adapter.getStatus();
    expect(status.channel).toBe('slack');
    expect(status.connected).toBe(false);
  });

  it('start sets allowed users, message handler, and starts bridge', async () => {
    const bridge = makeMockSlackBridge();
    const adapter = new SlackBridgeAdapter({
      bridge: bridge as any,
      allowedUserIds: ['u1'],
    });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    expect(bridge.setAllowedUserIds).toHaveBeenCalledWith(['u1']);
    expect(bridge.setMessageHandler).toHaveBeenCalledOnce();
    expect(bridge.start).toHaveBeenCalledOnce();
  });

  it('message handler invokes onInbound with slack channel', async () => {
    const bridge = makeMockSlackBridge();
    const adapter = new SlackBridgeAdapter({ bridge: bridge as any });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    const handler = bridge.setMessageHandler.mock.calls[0]![0];
    handler({ userId: 'u1', channel: 'C1', text: 'hello', messageTs: '123', threadTs: '456' });

    expect(onInbound).toHaveBeenCalledWith('slack', expect.objectContaining({
      channel: 'slack',
      sender: { id: 'u1', name: 'unknown' },
      text: 'hello',
      threadId: 'C1',
      messageId: '456',
    }));
  });

  it('send sends message to threadId channel with replyTo', async () => {
    const bridge = makeMockSlackBridge();
    const adapter = new SlackBridgeAdapter({ bridge: bridge as any });

    await adapter.send({ text: 'hi', threadId: 'C1', replyTo: 'ts123' });
    expect(bridge.sendMessage).toHaveBeenCalledWith('C1', 'hi', 'ts123');
  });

  it('send falls back to defaultChannel when no threadId', async () => {
    const bridge = makeMockSlackBridge();
    const adapter = new SlackBridgeAdapter({ bridge: bridge as any, defaultChannel: 'default' });

    await adapter.send({ text: 'hi' });
    expect(bridge.sendMessage).toHaveBeenCalledWith('default', 'hi', undefined);
  });

  it('send throws when no channel available', async () => {
    const bridge = makeMockSlackBridge();
    const adapter = new SlackBridgeAdapter({ bridge: bridge as any });

    await expect(adapter.send({ text: 'hi' })).rejects.toThrow('Slack channel is required');
  });

  it('stop calls bridge.stop', async () => {
    const bridge = makeMockSlackBridge();
    const adapter = new SlackBridgeAdapter({ bridge: bridge as any });

    await adapter.stop();
    expect(bridge.stop).toHaveBeenCalledOnce();
  });

  it('getStatus returns normalized status', () => {
    const bridge = makeMockSlackBridge();
    const adapter = new SlackBridgeAdapter({ bridge: bridge as any });

    const status = adapter.getStatus();
    expect(status.channel).toBe('slack');
    expect(status.connected).toBe(true);
    expect(status.details).toEqual({ configured: true, team: 'test-team' });
  });
});

describe('EmailBridgeAdapter', () => {
  it('initializes with default config when no options provided', () => {
    const adapter = new EmailBridgeAdapter();
    const status = adapter.getStatus();
    expect(status.channel).toBe('email');
    expect(status.connected).toBe(false);
  });

  it('start sets message handler and starts bridge with config', async () => {
    const bridge = makeMockEmailBridge();
    const config = { smtpHost: 'smtp.test', smtpPort: 587, smtpUser: 'u', smtpPass: 'p', fromAddress: 'a@b.com' };
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any, emailConfig: config });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    expect(bridge.setMessageHandler).toHaveBeenCalledOnce();
    expect(bridge.start).toHaveBeenCalledWith(config);
  });

  it('message handler invokes onInbound with email channel and extracts address', async () => {
    const bridge = makeMockEmailBridge();
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    const handler = bridge.setMessageHandler.mock.calls[0]![0];
    handler({
      messageId: 'm1',
      inReplyTo: undefined,
      references: [],
      from: 'John Doe <john@test.com>',
      to: ['a@b.com'],
      subject: 'Test',
      text: 'Hello',
      html: undefined,
      attachments: [],
      date: new Date('2024-01-01T00:00:00Z'),
    });

    expect(onInbound).toHaveBeenCalledWith('email', expect.objectContaining({
      channel: 'email',
      sender: { id: 'john@test.com', name: 'John Doe <john@test.com>' },
      text: 'Hello',
      messageId: 'm1',
    }));
  });

  it('message handler falls back to text when html only', async () => {
    const bridge = makeMockEmailBridge();
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    const handler = bridge.setMessageHandler.mock.calls[0]![0];
    handler({
      messageId: 'm1',
      inReplyTo: undefined,
      references: [],
      from: 'simple@test.com',
      to: ['a@b.com'],
      subject: 'Test',
      text: undefined,
      html: '<p>Hello</p>',
      attachments: [],
      date: new Date('2024-01-01T00:00:00Z'),
    });

    expect(onInbound).toHaveBeenCalledWith('email', expect.objectContaining({
      text: '<p>Hello</p>',
      sender: { id: 'simple@test.com', name: 'simple@test.com' },
    }));
  });

  it('send sends email with subject', async () => {
    const bridge = makeMockEmailBridge();
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });

    await adapter.send({ text: 'body', to: 'recipient@test.com', subject: 'Subject' });
    expect(bridge.sendEmail).toHaveBeenCalledWith('recipient@test.com', 'Subject', 'body');
  });

  it('send uses default subject when none provided', async () => {
    const bridge = makeMockEmailBridge();
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });

    await adapter.send({ text: 'body', to: 'recipient@test.com' });
    expect(bridge.sendEmail).toHaveBeenCalledWith('recipient@test.com', 'No subject', 'body');
  });

  it('send replies when replyTo is set', async () => {
    const bridge = makeMockEmailBridge();
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });

    await adapter.send({ text: 'body', to: 'r@test.com', subject: 'Re: Subject', replyTo: 'orig-msg-id' });
    expect(bridge.replyTo).toHaveBeenCalledWith('orig-msg-id', 'r@test.com', 'Re: Subject', 'body');
  });

  it('send throws when no recipient', async () => {
    const bridge = makeMockEmailBridge();
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });

    await expect(adapter.send({ text: 'body' })).rejects.toThrow('Email recipient (to) is required');
  });

  it('stop calls bridge.stop', async () => {
    const bridge = makeMockEmailBridge();
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });

    await adapter.stop();
    expect(bridge.stop).toHaveBeenCalledOnce();
  });

  it('getStatus returns normalized status with all connections', () => {
    const bridge = makeMockEmailBridge();
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });

    const status = adapter.getStatus();
    expect(status.channel).toBe('email');
    expect(status.connected).toBe(true);
    expect(status.details).toEqual({
      configured: true, unreadCount: 3, imapConnected: true, smtpConnected: true,
    });
  });

  it('getStatus reports errors when lastError is set', () => {
    const bridge = makeMockEmailBridge();
    bridge.getStatus.mockReturnValue({
      connected: false, configured: true, unreadCount: 0,
      smtpConnected: false, imapConnected: true, lastError: 'SMTP failed',
    });
    const adapter = new EmailBridgeAdapter({ bridge: bridge as any });

    const status = adapter.getStatus();
    expect(status.connected).toBe(false);
    expect(status.errors).toEqual(['SMTP failed']);
  });
});

describe('TelegramBridgeAdapter', () => {
  it('initializes with default config when no options provided', () => {
    const adapter = new TelegramBridgeAdapter();
    const status = adapter.getStatus();
    expect(status.channel).toBe('telegram');
    expect(status.connected).toBe(false);
  });

  it('start attaches agent, sets handlers, and starts bridge', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any, telegramConfig: { botToken: 't' } });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    expect(bridge.attach).toHaveBeenCalledOnce();
    expect(bridge.setMessageHandler).toHaveBeenCalledOnce();
    expect(bridge.setFileHandler).toHaveBeenCalledOnce();
    expect(bridge.start).toHaveBeenCalledOnce();
  });

  it('message handler invokes onInbound with telegram channel', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    const handler = bridge.setMessageHandler.mock.calls[0]![0];
    handler('hello', 12345);

    expect(onInbound).toHaveBeenCalledWith('telegram', expect.objectContaining({
      channel: 'telegram',
      sender: { id: '12345', name: 'unknown' },
      text: 'hello',
      threadId: '12345',
    }));
  });

  it('file handler invokes onInbound with file info in text', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    const handler = bridge.setFileHandler.mock.calls[0]![0];
    handler('fileId', 'doc.pdf', 'application/pdf', 'See this', 12345);

    expect(onInbound).toHaveBeenCalledWith('telegram', expect.objectContaining({
      text: 'See this\n[file: doc.pdf (application/pdf)]',
      threadId: '12345',
    }));
  });

  it('file handler works without caption', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any });
    const onInbound: OnInboundCallback = vi.fn();

    await adapter.start(onInbound);

    const handler = bridge.setFileHandler.mock.calls[0]![0];
    handler('fileId', 'img.png', 'image/png', undefined, 12345);

    expect(onInbound).toHaveBeenCalledWith('telegram', expect.objectContaining({
      text: '[file: img.png (image/png)]',
    }));
  });

  it('send sends message to threadId chat', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any });

    await adapter.send({ text: 'hi', threadId: '12345' });
    expect(bridge.sendMessage).toHaveBeenCalledWith(12345, 'hi');
  });

  it('send falls back to config chatId when no threadId', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any, chatId: 99999 });

    await adapter.send({ text: 'hi' });
    expect(bridge.sendMessage).toHaveBeenCalledWith(99999, 'hi');
  });

  it('send throws when no chat id available', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any });

    await expect(adapter.send({ text: 'hi' })).rejects.toThrow('Telegram chat id is required');
  });

  it('send throws when chat id is not a valid number', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any });

    await expect(adapter.send({ text: 'hi', threadId: 'not-a-number' })).rejects.toThrow('Invalid Telegram chat id');
  });

  it('stop calls bridge.stop', async () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any });

    await adapter.stop();
    expect(bridge.stop).toHaveBeenCalledOnce();
  });

  it('getStatus returns normalized status', () => {
    const bridge = makeMockTelegramBridge();
    const adapter = new TelegramBridgeAdapter({ bridge: bridge as any });

    const status = adapter.getStatus();
    expect(status.channel).toBe('telegram');
    expect(status.connected).toBe(true);
    expect(status.details).toEqual({
      botUsername: 'testbot', lastActivity: '2024-01-01T00:00:00Z', messageCount: 10,
    });
  });
});
