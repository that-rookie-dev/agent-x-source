import { describe, expect, it } from 'vitest';
import {
  VoiceBlockStreamExtractor,
  VOICE_BLOCK_CLOSE,
  VOICE_BLOCK_OPEN,
  holdBackVoiceCloseSuffix,
  isAffirmativeReply,
  isVoiceSummaryOnlyMessage,
  userWantsVoiceChatReport,
  voiceOfferedChatReport,
  sanitizeSpeakableText,
  sanitizeVoiceDisplayText,
  buildCrewCallTurnInstruction,
  buildCrewCallOpenerInstruction,
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
    expect(extractor.pullSpeakDelta(' More details in chat⟨/')).toBe('More details in chat');
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

  it('detects short affirmative replies', () => {
    expect(isAffirmativeReply('yes please')).toBe(true);
    expect(isAffirmativeReply('Sure, go ahead!')).toBe(true);
    expect(isAffirmativeReply('okay')).toBe(true);
    expect(isAffirmativeReply('yes, but only the hotels near the river')).toBe(false);
    expect(isAffirmativeReply('tell me more about trains')).toBe(false);
    expect(isAffirmativeReply('no thanks')).toBe(false);
  });

  it('detects when the voice block offered the chat report', () => {
    const offer = `${VOICE_BLOCK_OPEN}I can give you budget tips, or should I put the full detailed report in the chat for you?${VOICE_BLOCK_CLOSE}`;
    expect(voiceOfferedChatReport(offer)).toBe(true);
    const noOffer = `${VOICE_BLOCK_OPEN}It will rain tomorrow in Paris.${VOICE_BLOCK_CLOSE}`;
    expect(voiceOfferedChatReport(noOffer)).toBe(false);
    expect(voiceOfferedChatReport('plain text, no voice block')).toBe(false);
  });

  it('strips stray tokens before the voice opener', async () => {
    const { normalizeVoiceAssistantContent, extractVoiceSpeakable } = await import('../src/voice-speakable.js');
    const raw = `承受${VOICE_BLOCK_OPEN}Good morning.${VOICE_BLOCK_CLOSE}`;
    const normalized = normalizeVoiceAssistantContent(raw);
    expect(normalized.startsWith(VOICE_BLOCK_OPEN)).toBe(true);
    expect(extractVoiceSpeakable(raw).voice).toBe('Good morning.');
    expect(extractVoiceSpeakable(raw).chat).toBe('');
  });

  it('normalizes ASCII <voice> tags to Unicode ⟨voice⟩', async () => {
    const { normalizeVoiceAssistantContent, extractVoiceSpeakable } = await import('../src/voice-speakable.js');
    const raw = '<voice>Hello there.</voice>';
    const normalized = normalizeVoiceAssistantContent(raw);
    expect(normalized.startsWith(VOICE_BLOCK_OPEN)).toBe(true);
    expect(extractVoiceSpeakable(raw).voice).toBe('Hello there.');
  });

  it('normalizes mixed ASCII/Unicode close tags like </voice⟩', async () => {
    const { extractVoiceSpeakable } = await import('../src/voice-speakable.js');
    const raw = `${VOICE_BLOCK_OPEN}Hello there.</voice⟩`;
    const { voice } = extractVoiceSpeakable(raw);
    expect(voice).toBe('Hello there.');
  });
});

describe('sanitizeSpeakableText', () => {
  it('strips LLM token bleed like ]<]minimax[>[', () => {
    expect(sanitizeSpeakableText('Hello ]<]minimax[>[ world')).toBe('Hello world');
  });

  it('strips trailing minimax bleed glued to a sentence', () => {
    const raw = "or something offbeat like the Alps or the Greek islands?]<]minimax[>[";
    expect(sanitizeSpeakableText(raw)).toBe('or something offbeat like the Alps or the Greek islands?');
    expect(sanitizeVoiceDisplayText(`${VOICE_BLOCK_OPEN}${raw}${VOICE_BLOCK_CLOSE}`)).toBe(
      'or something offbeat like the Alps or the Greek islands?',
    );
  });

  it('strips XML-like tags (tool_call, invoke, url)', () => {
    expect(sanitizeSpeakableText('<tool_call>something')).toBe('something');
    expect(sanitizeSpeakableText('<invoke name="web_fetch"><url>https://x</url></invoke>')).toBe('https://x');
  });

  it('strips stray angle brackets and square brackets', () => {
    expect(sanitizeSpeakableText('text with [brackets] and < angles >')).toBe('text with brackets and angles');
  });

  it('preserves normal speech text', () => {
    expect(sanitizeSpeakableText('Hello, how are you today?')).toBe('Hello, how are you today?');
  });

  it('collapses whitespace after stripping', () => {
    expect(sanitizeSpeakableText('Hello   world')).toBe('Hello world');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeSpeakableText('')).toBe('');
  });
});

describe('VoiceBlockStreamExtractor sanitization', () => {
  it('strips token bleed from streamed voice content', () => {
    const extractor = new VoiceBlockStreamExtractor();
    const delta = `${VOICE_BLOCK_OPEN}Hello ]<]minimax[>[ world.${VOICE_BLOCK_CLOSE}`;
    const spoken = extractor.pullSpeakDelta(delta);
    expect(spoken).toBe('Hello world.');
    expect(extractor.closed).toBe(true);
  });

  it('strips XML tags from streamed voice content', () => {
    const extractor = new VoiceBlockStreamExtractor();
    const delta = `${VOICE_BLOCK_OPEN}Fetching <tool_call>data now.${VOICE_BLOCK_CLOSE}`;
    const spoken = extractor.pullSpeakDelta(delta);
    expect(spoken).toBe('Fetching data now.');
    expect(extractor.closed).toBe(true);
  });
});

describe('crew call voice instructions', () => {
  it('keeps crew call turns in phone-call character', () => {
    const instr = buildCrewCallTurnInstruction();
    expect(instr).toContain('CREW PHONE CALL');
    expect(instr).toContain('not Agent-X');
    expect(instr).toContain(VOICE_BLOCK_OPEN);
    expect(instr).not.toContain('put the full report');
  });

  it('asks the persona to speak first on open and resume', () => {
    expect(buildCrewCallOpenerInstruction('open')).toMatch(/speak first/i);
    expect(buildCrewCallOpenerInstruction('open')).toMatch(/welcome/i);
    expect(buildCrewCallOpenerInstruction('resume')).toMatch(/on hold/i);
  });
});
