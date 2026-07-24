/**
 * Document Studio — event bus tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { DocumentStudioEventBus, formatSseEvent } from '../src/document-studio/events/DocumentStudioEventBus.js';
import type { Master, Job, Artifact } from '../src/document-studio/types.js';

const mockMaster = { id: 'm1', name: 'master' } as Master;
const mockJob = {
  id: 'j1',
  title: 'job',
  status: 'running',
  spec: { version: 1, intent: '', inputs: [], steps: [], policies: {} as any },
  progress: { done: 1, total: 2 },
  artifacts: [],
  createdAt: '',
  updatedAt: '',
} as Job;
const mockArtifact = { id: 'a1', jobId: 'j1', path: 'out', format: 'docx', checksum: '', createdAt: '' } as Artifact;

describe('DocumentStudioEventBus', () => {
  it('emits typed events to listeners', () => {
    const bus = new DocumentStudioEventBus();
    const fn = vi.fn();
    bus.on('master.analysis', fn);
    bus.emit('master.analysis', { type: 'master.analysis', master: mockMaster, timestamp: 't1' });
    expect(fn).toHaveBeenCalledWith({ type: 'master.analysis', master: mockMaster, timestamp: 't1' });
  });

  it('unsubscribe works', () => {
    const bus = new DocumentStudioEventBus();
    const fn = vi.fn();
    const unsub = bus.on('job.progress', fn);
    unsub();
    bus.emit('job.progress', { type: 'job.progress', job: mockJob, timestamp: 't1' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('subscribe forwards every event type', () => {
    const bus = new DocumentStudioEventBus();
    const fn = vi.fn();
    const unsub = bus.subscribe(fn);
    bus.emit('master.analysis', { type: 'master.analysis', master: mockMaster, timestamp: 't1' });
    bus.emit('job.progress', { type: 'job.progress', job: mockJob, timestamp: 't1' });
    bus.emit('job.gate', { type: 'job.gate', job: mockJob, gate: 'final', timestamp: 't1' });
    bus.emit('artifact.ready', { type: 'artifact.ready', artifact: mockArtifact, jobId: 'j1', timestamp: 't1' });
    expect(fn).toHaveBeenCalledTimes(4);
    unsub();
    bus.emit('master.analysis', { type: 'master.analysis', master: mockMaster, timestamp: 't2' });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('listener errors do not stop the bus', () => {
    const bus = new DocumentStudioEventBus();
    bus.on('master.analysis', () => { throw new Error('boom'); });
    const fn = vi.fn();
    bus.on('master.analysis', fn);
    bus.emit('master.analysis', { type: 'master.analysis', master: mockMaster, timestamp: 't1' });
    expect(fn).toHaveBeenCalled();
  });
});

describe('SSE serialization', () => {
  it('serializes an event to SSE data lines', () => {
    const event = { type: 'job.progress', job: mockJob, timestamp: 't1' };
    expect(formatSseEvent(event)).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });
});
