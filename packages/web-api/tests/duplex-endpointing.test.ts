import { describe, it, expect } from 'vitest';
import {
  createDuplexEndpointState,
  updateDuplexEndpointing,
} from '../src/voice/duplex-endpointing.js';

const THRESHOLD = 2_000;

describe('updateDuplexEndpointing', () => {
  it('does not finish on silence before any words', () => {
    let state = createDuplexEndpointState(1_000);
    const first = updateDuplexEndpointing(state, {
      now: 4_000,
      isSpeech: false,
      wordsNow: '',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    });
    expect(first.shouldFinish).toBe(false);
    expect(first.state.duplexSilenceMs).toBe(0);
  });

  it('finishes after words then acoustic silence past threshold', () => {
    let state = createDuplexEndpointState(0);

    const speaking = updateDuplexEndpointing(state, {
      now: 1_000,
      isSpeech: true,
      wordsNow: 'hello there',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    });
    state = speaking.state;
    expect(state.duplexHadWords).toBe(true);
    expect(state.duplexSilenceMs).toBe(0);
    expect(speaking.shouldFinish).toBe(false);

    const silent = updateDuplexEndpointing(state, {
      now: 3_200,
      isSpeech: false,
      wordsNow: 'hello there',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    });
    expect(silent.state.duplexSilenceMs).toBeGreaterThanOrEqual(THRESHOLD);
    expect(silent.shouldFinish).toBe(true);
  });

  it('does not reset silence when Whisper rephrases the same utterance during silence', () => {
    let state = createDuplexEndpointState(0);
    state = updateDuplexEndpointing(state, {
      now: 1_000,
      isSpeech: true,
      wordsNow: 'what time is it',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    }).state;

    state = updateDuplexEndpointing(state, {
      now: 2_000,
      isSpeech: false,
      wordsNow: 'what time is it',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    }).state;

    const rephrase = updateDuplexEndpointing(state, {
      now: 2_500,
      isSpeech: false,
      wordsNow: 'What time is it?',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    });

    // Rephrase is not a +3 char growth over prior — silence clock must keep advancing.
    expect(rephrase.state.duplexSilenceMs).toBeGreaterThanOrEqual(500);
    expect(rephrase.shouldFinish).toBe(false);

    const done = updateDuplexEndpointing(rephrase.state, {
      now: 4_100,
      isSpeech: false,
      wordsNow: 'What time is it?',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    });
    expect(done.shouldFinish).toBe(true);
  });

  it('resets silence when transcript clearly grows', () => {
    let state = createDuplexEndpointState(0);
    state = updateDuplexEndpointing(state, {
      now: 1_000,
      isSpeech: false,
      wordsNow: 'hi',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    }).state;

    const grew = updateDuplexEndpointing(state, {
      now: 1_500,
      isSpeech: false,
      wordsNow: 'hi there friend',
      wordsAvailable: true,
      silenceThresholdMs: THRESHOLD,
      hasAudio: true,
      turnInFlight: false,
    });
    expect(grew.state.duplexSilenceMs).toBe(0);
    expect(grew.shouldFinish).toBe(false);
  });
});
