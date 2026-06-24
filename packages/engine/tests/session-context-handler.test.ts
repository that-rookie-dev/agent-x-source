import { describe, it, expect } from 'vitest';
import {
  SessionContextHandler,
  createCrewPrivateContextHandler,
} from '../src/context/SessionContextHandler.js';
import { SessionNarrativeStore } from '../src/context/SessionNarrativeStore.js';

describe('SessionContextHandler narrative memory', () => {
  it('builds story paragraphs instead of chat transcripts', () => {
    const store = new SessionNarrativeStore();
    const handler = new SessionContextHandler({ sessionId: 'sess-a', store });

    handler.recordUser(
      'Plan a beach vacation with my wife and 4-month-old baby — first international trip with shopping.',
    );
    handler.recordAssistant('I asked about travel dates and budget preferences.');
    handler.registerCrew({ crewId: 'c1', name: 'Elias', callsign: 'elias_travel', relationship: 'deployed' });
    handler.recordUser('plan it yourself');

    const block = handler.getNarrativeBlock();
    expect(block).toContain('[SESSION NARRATIVE]');
    expect(block).not.toMatch(/User:/);
    expect(block).not.toMatch(/Assistant:/);
    expect(block).toContain('opened this session');
    expect(block).toContain('Elias');
    expect(block).toContain('reasonable assumptions');
    expect(block).toContain('Specialists in this session');
  });

  it('isolates sessions — no cross-session narrative access', () => {
    const store = new SessionNarrativeStore();
    const a = new SessionContextHandler({ sessionId: 'sess-a', store });
    const b = new SessionContextHandler({ sessionId: 'sess-b', store });

    a.recordUser('Plan a trip to Bali');
    b.recordUser('Write Python code for auth');

    expect(a.getSessionIntent()).toContain('Bali');
    expect(b.getSessionIntent()).toContain('Python');
    expect(a.getNarrativeText()).not.toContain('Python');
    expect(b.getNarrativeText()).not.toContain('Bali');

    expect(() => a.assertSameSession('sess-b')).toThrow(/isolation/i);
  });

  it('prepares crew_private foundation without Agent-X in narrative', () => {
    const store = new SessionNarrativeStore();
    const handler = createCrewPrivateContextHandler({
      sessionId: 'crew-chat-1',
      crewId: 'c9',
      crewName: 'Elias Svensson',
      callsign: 'elias_travel',
      store,
    });

    const text = handler.getNarrativeText();
    expect(text).toContain('private crew chat');
    expect(text).toContain('Agent-X is not part');
    expect(text).toContain('Elias Svensson');
  });
});
