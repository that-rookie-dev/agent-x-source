import { describe, expect, it } from 'vitest';
import {
  effectiveAutomationNotifyChannels,
  getNotificationChannelStatus,
  inferAutomationSourceChannel,
  mandatoryAutomationNotifyChannels,
  normalizeAutomationTaskOrigin,
  resolveAutomationNotifyChannels,
  resolveTelegramOutboundChatId,
} from '../src/automation/automation-notify.js';
import type { AgentXConfig } from '@agentx/shared';

const baseCfg = {
  provider: { activeProvider: 'openai', activeModel: 'gpt-4', providers: {} },
} as AgentXConfig;

describe('resolveAutomationNotifyChannels', () => {
  it('includes telegram origin when resolved from channel session', () => {
    const cfg: AgentXConfig = {
      ...baseCfg,
      channels: {
        telegram: { enabled: true, botToken: '123:ABC', chatId: '999', outbound: true },
      },
    };
    const status = getNotificationChannelStatus(cfg);
    const channels = resolveAutomationNotifyChannels({
      sourceChannel: 'telegram',
      sourceSessionId: '__channel__',
      status,
    });
    expect(channels).toContain('in_app');
    expect(channels).toContain('telegram');
  });

  it('infers telegram origin from __channel__ session id', () => {
    expect(inferAutomationSourceChannel('web', '__channel__')).toBe('telegram');
  });

  it('infers slack origin from per-channel session id', () => {
    expect(inferAutomationSourceChannel('web', '__channel__:slack')).toBe('slack');
  });

  it('effectiveAutomationNotifyChannels adds origin even when task only has in_app', () => {
    const cfg: AgentXConfig = {
      ...baseCfg,
      channels: {
        telegram: { enabled: true, botToken: '123:ABC', chatId: '999', outbound: true },
      },
    };
    const status = getNotificationChannelStatus(cfg);
    const channels = effectiveAutomationNotifyChannels(
      ['in_app'],
      { sourceChannel: 'telegram', sourceSessionId: '__channel__', notifyChannels: ['in_app'] },
      status,
    );
    expect(channels).toContain('telegram');
  });
});

describe('automation-notify telegram status', () => {
  it('treats telegram as configured when runtime chat id is known', () => {
    const cfg: AgentXConfig = {
      ...baseCfg,
      channels: {
        telegram: { enabled: true, botToken: '123:ABC', outbound: true },
      },
    };
    expect(resolveTelegramOutboundChatId(cfg, { telegramChatId: '999' })).toBe('999');
    const status = getNotificationChannelStatus(cfg, { telegramChatId: '999' });
    expect(status.telegram.configured).toBe(true);
  });

  it('marks telegram not configured without chat id', () => {
    const cfg: AgentXConfig = {
      ...baseCfg,
      channels: {
        telegram: { enabled: true, botToken: '123:ABC', outbound: true },
      },
    };
    const status = getNotificationChannelStatus(cfg);
    expect(status.telegram.configured).toBe(false);
  });
});

describe('mandatoryAutomationNotifyChannels', () => {
  it('always includes origin telegram for __channel__ even when stored notify is empty', () => {
    const channels = mandatoryAutomationNotifyChannels('web', '__channel__', []);
    expect(channels).toContain('in_app');
    expect(channels).toContain('telegram');
  });

  it('normalizeAutomationTaskOrigin repairs web + empty notify from channel session', () => {
    const normalized = normalizeAutomationTaskOrigin({
      sourceChannel: 'web',
      sourceSessionId: '__channel__',
      notifyChannels: [],
    });
    expect(normalized.sourceChannel).toBe('telegram');
    expect(normalized.notifyChannels).toContain('telegram');
    expect(normalized.notifyChannels).toContain('in_app');
  });
});
