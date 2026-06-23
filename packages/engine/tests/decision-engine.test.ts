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
});
