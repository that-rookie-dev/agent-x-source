import { describe, it, expect } from 'vitest';
import {
  CHANNEL_SESSION_ID,
  channelSessionIdForBinding,
  isChannelSessionId,
  isSuperSessionId,
  parseChannelBindingFromSessionId,
  resolveAutomationSessionScope,
  resolveFleetToolSessionScope,
} from '../src/utils/channel-session.js';
import { crewVoiceSessionId } from '../src/utils/crew-voice-session.js';

describe('channel super session utils', () => {
  it('treats legacy and per-channel ids as super sessions', () => {
    expect(isSuperSessionId(CHANNEL_SESSION_ID)).toBe(true);
    expect(isSuperSessionId(channelSessionIdForBinding('telegram'))).toBe(true);
    expect(isSuperSessionId(channelSessionIdForBinding('slack'))).toBe(true);
    expect(isSuperSessionId('abc-123')).toBe(false);
  });

  it('builds per-channel session ids', () => {
    expect(channelSessionIdForBinding('telegram')).toBe('__channel__:telegram');
    expect(channelSessionIdForBinding('discord')).toBe('__channel__:discord');
  });

  it('parses channel binding from session id', () => {
    expect(parseChannelBindingFromSessionId('__channel__')).toBe('telegram');
    expect(parseChannelBindingFromSessionId('__channel__:slack')).toBe('slack');
    expect(parseChannelBindingFromSessionId('__channel__:unknown')).toBeNull();
    expect(parseChannelBindingFromSessionId('desktop-1')).toBeNull();
  });

  it('recognizes all channel session id forms', () => {
    expect(isChannelSessionId('__channel__')).toBe(true);
    expect(isChannelSessionId('__channel__:email')).toBe(true);
    expect(isChannelSessionId('session-1')).toBe(false);
  });

  it('drops session filter for fleet tools on super sessions', () => {
    expect(resolveFleetToolSessionScope(CHANNEL_SESSION_ID)).toBeUndefined();
    expect(resolveFleetToolSessionScope(channelSessionIdForBinding('telegram'))).toBeUndefined();
    expect(resolveFleetToolSessionScope('session-1')).toBe('session-1');
  });

  it('maps crew voice sessions to the parent text session for automations', () => {
    const textId = 'crew-text-abc';
    const voiceId = crewVoiceSessionId(textId);
    expect(resolveAutomationSessionScope(voiceId)).toBe(textId);
    expect(resolveAutomationSessionScope(textId)).toBe(textId);
    expect(resolveAutomationSessionScope(channelSessionIdForBinding('telegram'))).toBeUndefined();
  });
});
