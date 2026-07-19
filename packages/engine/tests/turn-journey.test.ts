import { describe, expect, it } from 'vitest';
import { runTurnJourney } from '../src/agent/TurnJourney.js';

describe('TurnJourney', () => {
  it('skips on fast path', async () => {
    const result = await runTurnJourney({
      userText: 'hi',
      skip: true,
      availableToolIds: ['knowledge_search', 'web_search'],
    });
    expect(result.journeyBlock).toBe('');
    expect(result.ragResults).toEqual([]);
  });

  it('builds a staged brief with tools inventory', async () => {
    const result = await runTurnJourney({
      userText: 'What does the Rig Veda say about Agni?',
      skip: false,
      availableToolIds: [
        'knowledge_search',
        'web_search',
        'deep_web_search',
        'integration__gmail__list_messages',
        'integration__notion__search',
      ],
    });
    expect(result.journeyBlock).toContain('[TURN_JOURNEY]');
    expect(result.journeyBlock).toContain('STAGE 1');
    expect(result.journeyBlock).toContain('STAGE 3');
    expect(result.journeyBlock).toContain('gmail');
    expect(result.journeyBlock).toContain('notion');
    expect(result.journeyBlock).toContain('web_search');
    expect(result.stages.some((s) => s.id === 'web' && s.status === 'ready')).toBe(true);
  });

  it('uses a shorter voice brief', async () => {
    const result = await runTurnJourney({
      userText: 'remind me what we uploaded',
      skip: false,
      voiceTurn: true,
      availableToolIds: ['knowledge_search', 'web_search'],
    });
    expect(result.journeyBlock).toContain('[TURN_JOURNEY]');
    expect(result.journeyBlock).toContain('Default silent research order');
    expect(result.journeyBlock).not.toContain('STAGE 1');
  });
});
