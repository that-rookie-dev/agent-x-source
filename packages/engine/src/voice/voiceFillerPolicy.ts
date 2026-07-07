/** Heuristic: skip instant "Got it" ack for greetings, mic checks, and light chat. */
export function shouldSpeakVoiceAckFiller(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase().replace(/[^\w\s'?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  if (/^(hi|hello|hey|hiya|good morning|good evening|good afternoon|yo|sup|howdy|greetings)\b/.test(normalized)) {
    return false;
  }

  if (/\b(can you hear me|are you there|you there|testing|test test|mic check|audio check|do you hear me|is this working|hello there)\b/.test(normalized)) {
    return false;
  }

  if (/^(thanks|thank you|ok|okay|cool|great|nice|perfect|got it|bye|goodbye|see you|good night)\b/.test(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/);
  const actionIntent = /\b(search|find|create|build|write|run|execute|deploy|install|download|analyze|analyse|research|schedule|remind|send|delete|update|fix|help me|look up|what is|how do|explain|summarize|summarise|compare|list|generate|make me|tell me about|show me)\b/;
  if (words.length <= 10 && !actionIntent.test(normalized)) {
    return false;
  }

  return true;
}
