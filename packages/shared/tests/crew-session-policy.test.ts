import { describe, expect, it } from 'vitest';
import {
  allowsCrewInvolvement,
  crewParticipationMode,
  deniesAutonomousCrewTools,
} from '../src/utils/crew-session-policy.js';
import { CHANNEL_SESSION_ID, channelSessionIdForBinding } from '../src/utils/channel-session.js';

describe('crewParticipationMode', () => {
  it('blocks crew on Agent-X core super session', () => {
    expect(crewParticipationMode('agent_x_core', 'core-session-id')).toBe('none');
  });

  it('blocks crew on messaging channel super sessions', () => {
    expect(crewParticipationMode('agent_x', CHANNEL_SESSION_ID)).toBe('none');
    expect(crewParticipationMode('agent_x', channelSessionIdForBinding('telegram'))).toBe('none');
  });

  it('allows explicit-only crew on regular Agent-X sessions', () => {
    expect(crewParticipationMode('agent_x', 'child-session-1')).toBe('explicit_only');
  });

  it('uses host-only mode for crew private chats', () => {
    expect(crewParticipationMode('crew_private', 'crew-private-1')).toBe('host_only');
  });
});

describe('allowsCrewInvolvement', () => {
  it('allows @mention and picker only on group sessions', () => {
    expect(allowsCrewInvolvement('mention', 'agent_x', 'sess-1')).toBe(true);
    expect(allowsCrewInvolvement('delegate_picker', 'agent_x', 'sess-1')).toBe(true);
    expect(allowsCrewInvolvement('active_continuation', 'agent_x', 'sess-1')).toBe(false);
    expect(allowsCrewInvolvement('spawn_tool', 'agent_x', 'sess-1')).toBe(false);
  });

  it('denies all orchestration paths on super sessions', () => {
    expect(allowsCrewInvolvement('mention', 'agent_x_core', 'core')).toBe(false);
    expect(allowsCrewInvolvement('delegate_picker', 'agent_x_core', 'core')).toBe(false);
    expect(allowsCrewInvolvement('active_continuation', 'agent_x_core', 'core')).toBe(false);
  });
});

describe('deniesAutonomousCrewTools', () => {
  it('denies LLM-initiated crew tools on super and group sessions', () => {
    expect(deniesAutonomousCrewTools('agent_x_core', 'core')).toBe(true);
    expect(deniesAutonomousCrewTools('agent_x', 'sess-1')).toBe(true);
  });
});
