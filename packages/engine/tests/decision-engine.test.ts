import { describe, it, expect } from 'vitest';
import { DecisionEngine } from '../src/agent/DecisionEngine.js';

describe('DecisionEngine', () => {
  const engine = new DecisionEngine();

  it('fast-path cache: matches greetings', () => {
    const r = engine.classify('Hi there!', 1);
    expect(r.messageClass).toBe('greeting');
    expect(r.executionPath).toBe('fast_reply');
    expect(r.skipTools).toBe(true);
  });

  it('fast-path cache: matches farewells', () => {
    const r = engine.classify('Goodbye, thanks!', 1);
    expect(r.messageClass).toBe('farewell');
    expect(r.executionPath).toBe('fast_reply');
  });

  it('fast-path cache: matches acknowledgments', () => {
    const r = engine.classify('okay got it', 1);
    expect(r.executionPath).toBe('fast_reply');
  });

  it('LLM decides: tasks go to standard', () => {
    const r = engine.classify('Build a microservice with auth', 1);
    expect(r.messageClass).toBe('task');
    expect(r.executionPath).toBe('standard');
    expect(r.skipTools).toBe(false);
  });

  it('LLM decides: questions go to standard', () => {
    const r = engine.classify('What is Kubernetes?', 1);
    expect(r.executionPath).toBe('standard');
  });

  it('LLM decides: file analysis goes to standard', () => {
    const r = engine.classify('can you analyse my tax forecast file?', 1);
    expect(r.messageClass).toBe('task');
    expect(r.executionPath).toBe('standard');
  });

  it('LLM decides: uncommon slang misses cache, goes to standard', () => {
    const r = engine.classify('wagwan fam what you saying', 1);
    expect(r.executionPath).toBe('standard');
  });

  it('fast_reply skips tools and RAG, standard does not', () => {
    expect(engine.classify('Hi', 1).skipTools).toBe(true);
    expect(engine.classify('Hi', 1).skipRag).toBe(true);
    expect(engine.classify('task', 1).skipTools).toBe(false);
    expect(engine.classify('task', 1).skipRag).toBe(false);
  });

  it('ack after a pending assistant question routes standard (contextual follow-up)', () => {
    const r = engine.classify('yes please', 5, {
      lastAssistantMessage: 'Would you like hotel recommendations or a budget breakdown for this itinerary?',
    });
    expect(r.executionPath).toBe('standard');
    expect(r.messageClass).toBe('task');
  });

  it('ack after a pending question inside a voice block routes standard', () => {
    const r = engine.classify('sure', 5, {
      lastAssistantMessage: '⟨voice⟩Should I put the full report in the chat for you?⟨/voice⟩',
    });
    expect(r.executionPath).toBe('standard');
  });

  it('ack after a plain statement still fast-replies', () => {
    const r = engine.classify('okay got it', 5, {
      lastAssistantMessage: 'Done — I saved the note to your workspace.',
    });
    expect(r.executionPath).toBe('fast_reply');
  });

  it('voice turns always route standard, even greetings', () => {
    const r = engine.classify('Hi there!', 1, { voiceTurn: true });
    expect(r.executionPath).toBe('standard');
  });
});
