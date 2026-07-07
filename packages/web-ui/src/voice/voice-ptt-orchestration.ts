import type { VoiceClientState } from './VoiceSessionClient';
import type { CommsPhase } from '../components/voice/voice-comms-phase';
import { resolveCommsPhase } from '../components/voice/voice-comms-phase';
import {
  pipelineToCommsPhase,
  pipelineWaveMode,
  type VoiceTurnPipeline,
} from './voice-turn-pipeline';

export interface PttSessionSnapshot {
  state: VoiceClientState;
  holding: boolean;
  pttTurnLocked: boolean;
  agentTurnComplete: boolean;
  playbackActive: boolean;
  playbackLevel: number;
}

/** Block Space for new recordings while a turn is in flight (release → playback end). */
export function computePushToTalkBlocked(session: PttSessionSnapshot): boolean {
  if (session.holding) return false;
  if (!session.pttTurnLocked) return false;
  if (session.playbackActive && session.agentTurnComplete) return false;
  return true;
}

export function resolvePttCommsPhase(input: {
  bootPhase: string;
  commsReady: boolean;
  state: VoiceClientState;
  holding: boolean;
  isDuplex: boolean;
  operatorText: string;
  agentText: string;
  playbackLevel: number;
  pttTurnLocked: boolean;
  playbackActive: boolean;
  turnPipeline?: VoiceTurnPipeline;
}): CommsPhase {
  const pipelinePhase = input.turnPipeline
    ? pipelineToCommsPhase(input.turnPipeline)
    : null;
  if (pipelinePhase) return pipelinePhase;

  if (input.pttTurnLocked && input.playbackActive) {
    return 'agent_tx';
  }
  const phase = resolveCommsPhase({
    bootPhase: input.bootPhase,
    commsReady: input.commsReady,
    state: input.state,
    holding: input.holding,
    isDuplex: input.isDuplex,
    operatorText: input.operatorText,
    agentText: input.agentText,
    playbackLevel: input.playbackLevel,
  });
  if (input.pttTurnLocked && phase === 'standby' && input.state === 'ready') {
    return input.agentText ? 'agent_prep' : 'operator_stt';
  }
  return phase;
}

export function resolvePttWaveMode(
  turnPipeline: VoiceTurnPipeline,
  operatorActive: boolean,
  agentActive: boolean,
): 'idle' | 'user' | 'agent' {
  const fromPipeline = pipelineWaveMode(turnPipeline);
  if (fromPipeline !== 'idle') return fromPipeline;
  if (agentActive) return 'agent';
  if (operatorActive) return 'user';
  return 'idle';
}
