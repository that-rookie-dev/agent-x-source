import type { CommsPhase } from '../components/voice/voice-comms-phase';

/**
 * Client-side voice pipeline — each stage maps to a real async step.
 * Advance only on events; never skip ahead of work in flight.
 */
export type VoiceTurnPipeline =
  | 'idle'
  | 'linking'
  | 'opening_mic'
  | 'capturing'
  | 'sending_audio'
  | 'transcribing'
  | 'agent_thinking'
  | 'llm_processing'
  | 'synthesizing'
  | 'speaking';

export interface PipelineLabelContext {
  agentStatus?: string;
  partialTranscript?: string;
}

export function pipelineToCommsPhase(pipeline: VoiceTurnPipeline): CommsPhase | null {
  switch (pipeline) {
    case 'linking':
    case 'opening_mic':
      return 'link';
    case 'capturing':
      return 'operator_record';
    case 'sending_audio':
    case 'transcribing':
      return 'operator_stt';
    case 'agent_thinking':
    case 'llm_processing':
    case 'synthesizing':
      return 'relay_process';
    case 'speaking':
      return 'agent_tx';
    default:
      return null;
  }
}

/** Wave visible only while mic is open or agent audio is playing. */
export function pipelineWaveMode(pipeline: VoiceTurnPipeline): 'idle' | 'user' | 'agent' {
  if (pipeline === 'capturing') return 'user';
  if (pipeline === 'speaking') return 'agent';
  return 'idle';
}

export function pipelineShowsLoader(pipeline: VoiceTurnPipeline): boolean {
  return pipeline !== 'idle' && pipeline !== 'capturing' && pipeline !== 'speaking';
}

export function pipelineStatusLabel(
  pipeline: VoiceTurnPipeline,
  context: PipelineLabelContext = {},
): string | null {
  const partial = context.partialTranscript?.trim();
  switch (pipeline) {
    case 'linking':
      return 'Opening session…';
    case 'opening_mic':
      return 'Opening microphone…';
    case 'capturing':
      return 'Recording · release Space';
    case 'sending_audio':
      return 'Sending audio…';
    case 'transcribing':
      return partial ? `Transcribing… "${truncate(partial, 36)}"` : 'Transcribing…';
    case 'agent_thinking':
      return 'Agent thinking…';
    case 'llm_processing':
      return context.agentStatus || 'LLM processing…';
    case 'synthesizing':
      return context.agentStatus || 'Processing…';
    case 'speaking':
      return 'Agent speaking';
    default:
      return null;
  }
}

export function isPipelineBusy(pipeline: VoiceTurnPipeline): boolean {
  return pipeline !== 'idle';
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
