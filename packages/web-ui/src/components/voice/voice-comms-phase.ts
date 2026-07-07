export type CommsPhase =
  | 'boot'
  | 'link'
  | 'standby'
  | 'operator_record'
  | 'operator_stt'
  | 'relay_process'
  | 'agent_prep'
  | 'agent_tx';

export function resolveCommsPhase(input: {
  bootPhase: string;
  commsReady: boolean;
  state: string;
  holding: boolean;
  isDuplex: boolean;
  operatorText: string;
  agentText: string;
  playbackLevel: number;
}): CommsPhase {
  const {
    bootPhase,
    commsReady,
    state,
    holding,
    isDuplex,
    operatorText,
    agentText,
    playbackLevel,
  } = input;

  if (bootPhase === 'booting') return 'boot';
  if (!commsReady || state === 'connecting') return 'link';

  if (state === 'speaking') {
    if (playbackLevel < 0.04 && !agentText) return 'agent_prep';
    return 'agent_tx';
  }

  if (state === 'processing') {
    if (agentText) return 'agent_prep';
    if (operatorText) return 'relay_process';
    return 'operator_stt';
  }

  if (state === 'listening' && (holding || isDuplex)) {
    return 'operator_record';
  }

  return 'standby';
}

export function phaseActiveChannel(phase: CommsPhase): 'operator' | 'relay' | 'agent' | null {
  switch (phase) {
    case 'boot':
    case 'link':
    case 'standby':
      return 'relay';
    case 'operator_record':
    case 'operator_stt':
      return 'operator';
    case 'relay_process':
      return 'relay';
    case 'agent_prep':
    case 'agent_tx':
      return 'agent';
    default:
      return null;
  }
}
