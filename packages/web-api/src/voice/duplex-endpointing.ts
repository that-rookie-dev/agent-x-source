/**
 * Local duplex end-of-utterance state machine.
 *
 * Acoustic silence (VAD) drives the clock once we've heard real words.
 * Whisper partial churn must NOT reset the silence clock while VAD says
 * the user has stopped speaking — that was the long-standing duplex bug.
 */

export interface DuplexEndpointState {
  duplexSilenceMs: number;
  duplexHadSpeech: boolean;
  duplexHadWords: boolean;
  duplexLastPartial: string;
  duplexLastWordAt: number;
  duplexLastSpeechAt: number;
  duplexVadSpeech: boolean;
}

export interface DuplexEndpointInput {
  now: number;
  /** Incremental VAD on the latest mic chunk only (null = unavailable). */
  isSpeech: boolean | null;
  /** Latest STT preview text (empty when throttled / unavailable this tick). */
  wordsNow: string;
  wordsAvailable: boolean;
  silenceThresholdMs: number;
  hasAudio: boolean;
  turnInFlight: boolean;
}

export interface DuplexEndpointResult {
  state: DuplexEndpointState;
  shouldFinish: boolean;
  emitPartial: boolean;
}

export function hasMeaningfulWords(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /[\p{L}\p{N}]/u.test(trimmed);
}

function transcriptGrew(prev: string, next: string): boolean {
  if (!prev) return next.trim().length > 0;
  // Require a clear growth so Whisper rephrases ("hello" → "Hello.") don't reset silence.
  return next.trim().length >= prev.trim().length + 3;
}

export function createDuplexEndpointState(now = 0): DuplexEndpointState {
  return {
    duplexSilenceMs: 0,
    duplexHadSpeech: false,
    duplexHadWords: false,
    duplexLastPartial: '',
    duplexLastWordAt: now,
    duplexLastSpeechAt: 0,
    duplexVadSpeech: false,
  };
}

export function updateDuplexEndpointing(
  prev: DuplexEndpointState,
  input: DuplexEndpointInput,
): DuplexEndpointResult {
  const state: DuplexEndpointState = { ...prev };
  const { now, isSpeech, wordsNow, wordsAvailable, silenceThresholdMs, hasAudio, turnInFlight } = input;

  if (isSpeech === true) {
    state.duplexVadSpeech = true;
    state.duplexHadSpeech = true;
    state.duplexLastSpeechAt = now;
    state.duplexLastWordAt = now;
    state.duplexSilenceMs = 0;
  } else if (isSpeech === false) {
    state.duplexVadSpeech = false;
  }

  let emitPartial = false;
  if (wordsAvailable) {
    const meaningful = hasMeaningfulWords(wordsNow);
    if (meaningful) {
      state.duplexHadWords = true;
      const changed = wordsNow !== state.duplexLastPartial;
      if (changed) {
        const grew = transcriptGrew(state.duplexLastPartial, wordsNow);
        state.duplexLastPartial = wordsNow;
        // Reset silence only when acoustic speech is present or the transcript
        // clearly grew — not on Whisper's idle rephrasing of the same utterance.
        if (state.duplexVadSpeech || isSpeech === true || grew) {
          state.duplexLastWordAt = now;
          state.duplexLastSpeechAt = Math.max(state.duplexLastSpeechAt, now);
          state.duplexSilenceMs = 0;
        }
      }
      emitPartial = true;
    }
  }

  const armed = state.duplexHadWords || state.duplexHadSpeech;
  if (armed && !state.duplexVadSpeech) {
    if (isSpeech === false || isSpeech === null) {
      const anchor = state.duplexLastSpeechAt || state.duplexLastWordAt;
      if (anchor > 0) {
        state.duplexSilenceMs = Math.max(0, now - anchor);
      }
    }
  } else if (!armed) {
    state.duplexSilenceMs = 0;
  }

  const shouldFinish = Boolean(
    state.duplexHadWords
    && !state.duplexVadSpeech
    && state.duplexSilenceMs >= silenceThresholdMs
    && hasAudio
    && !turnInFlight,
  );

  return { state, shouldFinish, emitPartial };
}
