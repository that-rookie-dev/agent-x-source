import { describe, expect, it } from 'vitest';
import { phaseActiveChannel, resolveCommsPhase } from '../src/components/voice/voice-comms-phase';

const base = {
  bootPhase: 'ready',
  commsReady: true,
  holding: false,
  isDuplex: false,
  operatorText: '',
  agentText: '',
  playbackLevel: 0,
};

describe('resolveCommsPhase', () => {
  it('walks operator → relay → agent during a turn', () => {
    expect(resolveCommsPhase({ ...base, state: 'listening', holding: true })).toBe('operator_record');
    expect(resolveCommsPhase({ ...base, state: 'processing' })).toBe('operator_stt');
    expect(resolveCommsPhase({ ...base, state: 'processing', operatorText: 'hello' })).toBe('relay_process');
    expect(resolveCommsPhase({ ...base, state: 'processing', operatorText: 'hello', agentText: 'reply' })).toBe('agent_prep');
    expect(resolveCommsPhase({ ...base, state: 'speaking', agentText: 'reply', playbackLevel: 0.2 })).toBe('agent_tx');
  });

  it('maps phases to active channels', () => {
    expect(phaseActiveChannel('operator_record')).toBe('operator');
    expect(phaseActiveChannel('relay_process')).toBe('relay');
    expect(phaseActiveChannel('agent_tx')).toBe('agent');
    expect(phaseActiveChannel('standby')).toBe('relay');
  });
});
