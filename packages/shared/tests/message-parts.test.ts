import { describe, it, expect } from 'vitest';
import { sanitizeForJson, stripToolNoise } from '../src/utils/text-sanitize.js';
import {
  assignPartsToAssistantMessage,
  buildPartsFromDbRows,
  normalizeMessageForUi,
  partsCorruptedByCrossTurn,
} from '../src/utils/message-parts.js';

describe('text-sanitize', () => {
  it('replaces lone surrogates', () => {
    const bad = 'hello \uD800 world';
    expect(sanitizeForJson(bad)).toBe('hello \uFFFD world');
  });

  it('strips tool noise from content', () => {
    const noisy = 'Here is the plan.\n🔧 Calling: file_write({})\n✅ Result: (no output)\nDone.';
    expect(stripToolNoise(noisy)).toBe('Here is the plan.\nDone.');
  });
});

describe('message-parts', () => {
  it('preserves spaces across text-delta chunks', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: "You're " },
      { type: 'text-delta', content: 'good to go!' },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.content).toBe("You're good to go!");
  });

  it('preserves word boundaries split across deltas', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: 'Found' },
      { type: 'text-delta', content: ' it! Let me' },
    ]);
    expect(parts[0]?.content).toBe('Found it! Let me');
  });

  it('builds chronological parts from db rows', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: 'Hello world' },
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-result', tool_call_id: 't1', tool_name: 'glob', tool_result: 'ok', tool_success: 1 },
    ]);
    expect(parts.some((p) => p.type === 'text' && p.content === 'Hello world')).toBe(true);
    expect(parts.some((p) => p.type === 'tool' && p.tool?.name === 'glob')).toBe(true);
  });

  it('dedupes duplicate tool-call rows and finalizes status', () => {
    const parts = buildPartsFromDbRows([
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-result', tool_call_id: 't1', tool_name: 'glob', tool_result: 'ok', tool_success: 1 },
    ]);
    expect(parts.filter((p) => p.type === 'tool')).toHaveLength(1);
    expect(parts.find((p) => p.type === 'tool')?.tool?.status).toBe('done');
  });

  it('detects cross-turn parts corruption', () => {
    const turn1Lead = "I'll provide you with a comprehensive analysis of TTS and STT models for your use case.";
    const turn2Content = 'Absolutely. Let me assess your current workspace and propose a practical integration architecture.';
    const corruptedParts = [
      { type: 'text' as const, id: '1', content: turn1Lead },
      { type: 'text' as const, id: '2', content: turn2Content },
    ];
    expect(partsCorruptedByCrossTurn(turn2Content, corruptedParts)).toBe(true);
    expect(partsCorruptedByCrossTurn(turn1Lead, [{ type: 'text', id: '1', content: turn1Lead }])).toBe(false);
  });

  it('normalizeMessageForUi drops corrupted stored parts and uses content', () => {
    const turn1Lead = "I'll provide you with a comprehensive analysis of TTS and STT.";
    const turn2Content = 'Absolutely. Let me assess your current workspace and propose integration.';
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: turn2Content,
      parts: [
        { type: 'text', id: '1', content: turn1Lead },
        { type: 'text', id: '2', content: turn2Content },
      ],
    }, []);
    expect(result.content).toBe(turn2Content);
    expect(result.parts?.filter((p) => p.type === 'text')).toHaveLength(1);
    expect(result.parts?.some((p) => p.type === 'text' && p.content?.includes(turn1Lead))).toBe(false);
  });

  it('assignPartsToAssistantMessage uses turn window after previous user message', () => {
    const messages = [
      { role: 'user', created_at: '2026-06-23T17:40:37.699Z' },
      { role: 'assistant', created_at: '2026-06-23T17:40:53.518Z' },
      { role: 'user', created_at: '2026-06-23T17:41:00.000Z' },
      { role: 'assistant', created_at: '2026-06-23T17:47:48.951Z' },
    ];
    const allParts = [
      { type: 'text-delta', content: 'turn1', created_at: '2026-06-23T17:40:40.000Z' },
      { type: 'text-delta', content: 'turn2', created_at: '2026-06-23T17:41:05.000Z' },
    ];
    const turn1Parts = assignPartsToAssistantMessage(messages, allParts, 1);
    const turn2Parts = assignPartsToAssistantMessage(messages, allParts, 3);
    expect(turn1Parts).toHaveLength(1);
    expect(turn1Parts[0]?.content).toBe('turn1');
    expect(turn2Parts).toHaveLength(1);
    expect(turn2Parts[0]?.content).toBe('turn2');
  });

  it('rebuilds assistant 1 when parts tools exceed toolCalls (merged turns)', () => {
    const turn1Content = "I'll provide you with a comprehensive analysis of TTS and STT models.";
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: turn1Content,
      parts: [
        { type: 'text', id: '1', content: turn1Content },
        { type: 'tool', id: 't1', tool: { id: 't1', name: 'web_search', status: 'done' } },
        { type: 'tool', id: 't2', tool: { id: 't2', name: 'folder_tree', status: 'done' } },
      ],
      toolCalls: [{ id: 't1', name: 'web_search', status: 'done' }],
    }, []);
    expect(result.parts?.filter((p) => p.type === 'tool')).toHaveLength(1);
    expect(result.parts?.find((p) => p.type === 'tool')?.tool?.name).toBe('web_search');
  });

  it('preserves questionnaire-only stored parts on restore', () => {
    const result = normalizeMessageForUi({
      role: 'assistant',
      content: '',
      parts: [{
        type: 'questionnaire',
        id: 'q1',
        questionnaire: {
          payload: { id: 'q1', questions: [{ id: 'a', prompt: 'Which?', type: 'text' }] },
          status: 'answered',
          answer: 'Which?: React',
        },
      }],
    });
    expect(result.parts?.some((p) => p.type === 'questionnaire')).toBe(true);
  });
});
