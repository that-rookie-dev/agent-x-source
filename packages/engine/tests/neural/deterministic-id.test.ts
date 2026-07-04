import { describe, it, expect } from 'vitest';
import { deterministicNodeId, deterministicEdgeId, normalizeForHash } from '../../src/neural/DeterministicId.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('normalizeForHash', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeForHash('Hello, World!')).toBe('hello world');
  });
  it('collapses multiple spaces', () => {
    expect(normalizeForHash('foo   bar')).toBe('foo bar');
  });
  it('trims leading/trailing whitespace', () => {
    expect(normalizeForHash('  hello  ')).toBe('hello');
  });
});

describe('deterministicNodeId', () => {
  it('produces the same ID for the same inputs', () => {
    const id1 = deterministicNodeId('Global Warming', 'Rising temperatures', 'doc1');
    const id2 = deterministicNodeId('Global Warming', 'Rising temperatures', 'doc1');
    expect(id1).toBe(id2);
  });
  it('produces different IDs for different labels', () => {
    const id1 = deterministicNodeId('Global Warming', 'Rising temperatures', 'doc1');
    const id2 = deterministicNodeId('Greenhouse Effect', 'Rising temperatures', 'doc1');
    expect(id1).not.toBe(id2);
  });
  it('produces different IDs for different sources', () => {
    const id1 = deterministicNodeId('Global Warming', 'Rising temperatures', 'doc1');
    const id2 = deterministicNodeId('Global Warming', 'Rising temperatures', 'doc2');
    expect(id1).not.toBe(id2);
  });
  it('produces different IDs for different content', () => {
    const id1 = deterministicNodeId('Global Warming', 'Rising temperatures', 'doc1');
    const id2 = deterministicNodeId('Global Warming', 'Cooling trend', 'doc1');
    expect(id1).not.toBe(id2);
  });
  it('is case-insensitive on label', () => {
    const id1 = deterministicNodeId('Global Warming', 'Rising temperatures', 'doc1');
    const id2 = deterministicNodeId('global warming', 'Rising temperatures', 'doc1');
    expect(id1).toBe(id2);
  });
  it('uses "global" namespace when no sourceId', () => {
    const id1 = deterministicNodeId('Test', 'Content', undefined);
    const id2 = deterministicNodeId('Test', 'Content', undefined);
    expect(id1).toBe(id2);
    expect(id1).toMatch(UUID_RE);
  });
  it('produces valid deterministic UUIDs (memory_nodes.id is a UUID column)', () => {
    const id = deterministicNodeId('Test', 'Content', 'src1');
    expect(id).toMatch(UUID_RE);
  });
});

describe('deterministicEdgeId', () => {
  it('produces the same ID for the same inputs', () => {
    const id1 = deterministicEdgeId('node1', 'node2', 'CAUSES');
    const id2 = deterministicEdgeId('node1', 'node2', 'CAUSES');
    expect(id1).toBe(id2);
  });
  it('produces different IDs for different relationship types', () => {
    const id1 = deterministicEdgeId('node1', 'node2', 'CAUSES');
    const id2 = deterministicEdgeId('node1', 'node2', 'REQUIRES');
    expect(id1).not.toBe(id2);
  });
  it('produces different IDs for swapped source/target', () => {
    const id1 = deterministicEdgeId('node1', 'node2', 'CAUSES');
    const id2 = deterministicEdgeId('node2', 'node1', 'CAUSES');
    expect(id1).not.toBe(id2);
  });
  it('produces me_ prefixed hex IDs', () => {
    const id = deterministicEdgeId('node1', 'node2', 'CAUSES');
    expect(id).toMatch(/^me_[0-9a-f]{8}$/);
  });
});
