import { describe, expect, it } from 'vitest';
import {
  VoiceBlockStreamExtractor,
  VOICE_BLOCK_CLOSE,
  VOICE_BLOCK_OPEN,
  holdBackVoiceCloseSuffix,
  isVoiceSummaryOnlyMessage,
  userWantsVoiceChatReport,
} from '../src/voice-speakable.js';

describe('holdBackVoiceCloseSuffix', () => {
  it('holds back partial close-tag prefixes', () => {
    expect(holdBackVoiceCloseSuffix('Hello world')).toEqual({ emit: 'Hello world', held: 0 });
    expect(holdBackVoiceCloseSuffix('Done⟨/')).toEqual({ emit: 'Done', held: 2 });
    expect(holdBackVoiceCloseSuffix('Done⟨/voice')).toEqual({ emit: 'Done', held: 7 });
  });
});

describe('VoiceBlockStreamExtractor', () => {
  it('does not speak partial close tag fragments', () => {
    const extractor = new VoiceBlockStreamExtractor();
    expect(extractor.pullSpeakDelta(`${VOICE_BLOCK_OPEN}It will rain today.`)).toBe('It will rain today.');
    expect(extractor.pullSpeakDelta(' More details in chat⟨/')).toBe(' More details in chat');
    expect(extractor.pullSpeakDelta('voice⟩')).toBe('');
    expect(extractor.closed).toBe(true);
    expect(extractor.pullSpeakDelta(' ignored markdown')).toBe('');
  });

  it('speaks full block when close tag arrives in one chunk', () => {
    const extractor = new VoiceBlockStreamExtractor();
    const delta = `${VOICE_BLOCK_OPEN}Short summary.${VOICE_BLOCK_CLOSE}`;
    expect(extractor.pullSpeakDelta(delta)).toBe('Short summary.');
    expect(extractor.closed).toBe(true);
  });
});

describe('voice interactive flow helpers', () => {
  it('detects chat report requests', () => {
    expect(userWantsVoiceChatReport('put the full report in chat')).toBe(true);
    expect(userWantsVoiceChatReport('show me the answer in the chat')).toBe(true);
    expect(userWantsVoiceChatReport('tell me more about trains')).toBe(false);
  });

  it('detects voice-summary-only assistant messages', () => {
    const voiceOnly = `${VOICE_BLOCK_OPEN}Summary here.${VOICE_BLOCK_CLOSE}`;
    expect(isVoiceSummaryOnlyMessage(voiceOnly)).toBe(true);
    expect(isVoiceSummaryOnlyMessage(`${voiceOnly}\n\n${'Detailed markdown body. '.repeat(8)}`)).toBe(false);
  });
});
