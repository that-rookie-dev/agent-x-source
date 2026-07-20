import { describe, expect, it } from 'vitest';
import { createMultiCrewSection } from '../src/prompt/assembly/sections.js';

describe('createMultiCrewSection', () => {
  const ctx = {
    personaName: 'Agent-X',
    enabledCrewSessionIds: new Set(['crew-1']),
    crewOrchestrator: {
      getMembers: () => [{
        crew: {
          id: 'crew-1',
          name: 'Raj Patel',
          title: 'Cloud Architect',
          callsign: 'raj_patel',
          systemPrompt: 'AWS specialist',
          expertise: ['AWS', 'Terraform'],
        },
        expertise: ['AWS', 'Terraform'],
      }],
    },
  } as never;

  it('diff tolerates serialized enabledIds arrays from prompt snapshots', () => {
    const section = createMultiCrewSection(ctx);
    const member = {
      id: 'crew-1',
      name: 'Raj Patel',
      title: 'Cloud Architect',
      callsign: 'raj_patel',
      systemPrompt: 'AWS specialist',
      expertise: ['AWS', 'Terraform'],
    };

    const prev = { members: [member], enabledIds: [] as string[] };
    const current = { members: [member], enabledIds: new Set(['crew-1']) };

    expect(() => section.diff(prev, current)).not.toThrow();
    expect(section.diff(prev, current)).toContain('raj_patel');
  });
});
