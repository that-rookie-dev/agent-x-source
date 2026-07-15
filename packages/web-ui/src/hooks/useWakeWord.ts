import { useEffect, useRef } from 'react';
import { WAKE_WORD_FALLBACK } from '../voice/wake-phrase';

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string } }>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useWakeWord(
  enabled: boolean,
  phrase: string,
  onDetected: () => void,
): void {
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const phraseRef = useRef(phrase || WAKE_WORD_FALLBACK);
  phraseRef.current = (phrase || WAKE_WORD_FALLBACK).toLowerCase();

  const restartRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    let recognition: SpeechRecognitionLike | null = null;
    let stopped = false;

    const start = () => {
      if (stopped) return;
      recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const text = event.results[i]?.[0]?.transcript?.toLowerCase() ?? '';
          if (text.includes(phraseRef.current)) {
            onDetectedRef.current();
          }
        }
      };
      recognition.onerror = () => {
        recognition?.stop();
      };
      recognition.onend = () => {
        if (!stopped) window.setTimeout(start, 400);
      };
      try {
        recognition.start();
      } catch {
        // ignore duplicate start
      }
    };

    restartRef.current = start;
    start();

    return () => {
      stopped = true;
      recognition?.stop();
      recognition = null;
    };
  }, [enabled, phrase]);
}

export { WAKE_WORD_FALLBACK as WAKE_WORD_DEFAULT_PHRASE };
