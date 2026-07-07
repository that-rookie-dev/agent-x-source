import { describe, expect, it } from 'vitest';
import {
  pipelineShowsLoader,
  pipelineStatusLabel,
  pipelineToCommsPhase,
  pipelineWaveMode,
} from '../src/voice/voice-turn-pipeline';
import { resolvePttCommsPhase, resolvePttWaveMode } from '../src/voice/voice-ptt-orchestration';

describe('voice turn pipeline', () => {
  it('maps pipeline stages to comms phases', () => {
    expect(pipelineToCommsPhase('linking')).toBe('link');
    expect(pipelineToCommsPhase('opening_mic')).toBe('link');
    expect(pipelineToCommsPhase('capturing')).toBe('operator_record');
    expect(pipelineToCommsPhase('sending_audio')).toBe('operator_stt');
    expect(pipelineToCommsPhase('transcribing')).toBe('operator_stt');
    expect(pipelineToCommsPhase('agent_thinking')).toBe('relay_process');
    expect(pipelineToCommsPhase('llm_processing')).toBe('relay_process');
    expect(pipelineToCommsPhase('synthesizing')).toBe('relay_process');
    expect(pipelineToCommsPhase('speaking')).toBe('agent_tx');
    expect(pipelineToCommsPhase('idle')).toBeNull();
  });

  it('shows wave only while capturing or speaking', () => {
    expect(pipelineWaveMode('linking')).toBe('idle');
    expect(pipelineWaveMode('opening_mic')).toBe('idle');
    expect(pipelineWaveMode('capturing')).toBe('user');
    expect(pipelineWaveMode('sending_audio')).toBe('idle');
    expect(pipelineWaveMode('transcribing')).toBe('idle');
    expect(pipelineWaveMode('speaking')).toBe('agent');
    expect(pipelineWaveMode('idle')).toBe('idle');
  });

  it('shows loaders for every non-wave wait stage', () => {
    expect(pipelineShowsLoader('linking')).toBe(true);
    expect(pipelineShowsLoader('opening_mic')).toBe(true);
    expect(pipelineShowsLoader('sending_audio')).toBe(true);
    expect(pipelineShowsLoader('transcribing')).toBe(true);
    expect(pipelineShowsLoader('llm_processing')).toBe(true);
    expect(pipelineShowsLoader('capturing')).toBe(false);
    expect(pipelineShowsLoader('speaking')).toBe(false);
    expect(pipelineShowsLoader('idle')).toBe(false);
  });

  it('labels each async step honestly', () => {
    expect(pipelineStatusLabel('linking')).toBe('Opening session…');
    expect(pipelineStatusLabel('opening_mic')).toBe('Opening microphone…');
    expect(pipelineStatusLabel('sending_audio')).toBe('Sending audio…');
    expect(pipelineStatusLabel('transcribing')).toBe('Transcribing…');
    expect(pipelineStatusLabel('transcribing', { partialTranscript: 'hello world' }))
      .toBe('Transcribing… "hello world"');
    expect(pipelineStatusLabel('agent_thinking')).toBe('Agent thinking…');
    expect(pipelineStatusLabel('llm_processing')).toBe('LLM processing…');
    expect(pipelineStatusLabel('llm_processing', { agentStatus: 'Agent processing' })).toBe('Agent processing');
    expect(pipelineStatusLabel('speaking')).toBe('Agent speaking');
  });
});

describe('resolvePttCommsPhase with pipeline', () => {
  const base = {
    bootPhase: 'ready',
    commsReady: true,
    state: 'ready' as const,
    holding: false,
    isDuplex: false,
    operatorText: '',
    agentText: '',
    playbackLevel: 0,
    pttTurnLocked: true,
    playbackActive: false,
  };

  it('prefers client pipeline over websocket state', () => {
    expect(resolvePttCommsPhase({ ...base, turnPipeline: 'linking' })).toBe('link');
    expect(resolvePttCommsPhase({ ...base, turnPipeline: 'sending_audio' })).toBe('operator_stt');
    expect(resolvePttCommsPhase({ ...base, turnPipeline: 'transcribing' })).toBe('operator_stt');
    expect(resolvePttCommsPhase({ ...base, turnPipeline: 'llm_processing' })).toBe('relay_process');
    expect(resolvePttCommsPhase({ ...base, turnPipeline: 'speaking' })).toBe('agent_tx');
  });
});

describe('resolvePttWaveMode with pipeline', () => {
  it('uses pipeline wave mode when active', () => {
    expect(resolvePttWaveMode('sending_audio', false, false)).toBe('idle');
    expect(resolvePttWaveMode('capturing', true, false)).toBe('user');
    expect(resolvePttWaveMode('speaking', false, true)).toBe('agent');
  });
});
