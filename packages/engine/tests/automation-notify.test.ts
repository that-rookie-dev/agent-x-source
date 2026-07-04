import { describe, expect, it } from 'vitest';
import {
  getNotificationChannelStatus,
  resolveTelegramOutboundChatId,
} from '../src/automation/automation-notify.js';
import type { AgentXConfig } from '@agentx/shared';

const baseCfg = {
  provider: { activeProvider: 'openai', activeModel: 'gpt-4', providers: {} },
} as AgentXConfig;

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
