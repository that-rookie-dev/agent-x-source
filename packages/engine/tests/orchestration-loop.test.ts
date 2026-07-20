import { describe, it, expect, beforeEach } from 'vitest';
import { ToolLedger } from '../src/agent/ToolLedger.js';
import { TurnStateManager } from '../src/agent/TurnStateManager.js';

describe('ToolLedger', () => {
  let ledger: ToolLedger;

  beforeEach(() => {
    ledger = new ToolLedger();
  });

  it('records and formats entries for history', () => {
    ledger.record({ name: 'glob', success: true, output: 'found 3 files', elapsed: 12 });
    ledger.record({ name: 'file_write', success: false, output: 'denied', elapsed: 5, path: '/tmp/x' });
    const formatted = ledger.formatForHistory();
    expect(formatted).toContain('[TURN TOOL LEDGER]');
    expect(formatted).toContain('[TOOL glob OK]');
    expect(formatted).toContain('[TOOL file_write FAILED path=/tmp/x]');
  });

  it('reset clears entries', () => {
    ledger.record({ name: 'glob', success: true, output: 'ok', elapsed: 1 });
    ledger.reset();
    expect(ledger.getEntries()).toHaveLength(0);
    expect(ledger.formatForHistory()).toBe('');
  });

  it('partitions successful vs failed writes', () => {
    ledger.record({ name: 'file_write', success: true, output: 'written', elapsed: 1 });
    ledger.record({ name: 'file_write', success: false, output: 'fail', elapsed: 1 });
    expect(ledger.getSuccessfulWrites()).toHaveLength(1);
    expect(ledger.getFailedWrites()).toHaveLength(1);
  });
});

describe('TurnStateManager', () => {
  let mgr: TurnStateManager;

  beforeEach(() => {
    mgr = new TurnStateManager();
  });

  it('starts in idle and transitions through phases', () => {
    expect(mgr.getSnapshot().phase).toBe('idle');
    mgr.start('turn-1', 'receiving');
    expect(mgr.phaseNow).toBe('running');
    mgr.setPhase('awaiting_plan', 'plan_review');
    expect(mgr.getSnapshot()).toMatchObject({ phase: 'awaiting_plan', stage: 'plan_review', turnId: 'turn-1' });
    mgr.complete();
    expect(mgr.getSnapshot().phase).toBe('done');
  });

  it('tracks stage and step updates', () => {
    mgr.start('t2');
    mgr.setStage('thinking', 0);
    mgr.setStage('execution', 3);
    const snap = mgr.getSnapshot();
    expect(snap.stage).toBe('execution');
    expect(snap.step).toBe(3);
    expect(snap.startedAt).toBeTruthy();
    expect(snap.lastActivityAt).toBeTruthy();
  });

  it('cancel and reset restore idle', () => {
    mgr.start('t3');
    mgr.cancel();
    expect(mgr.getSnapshot().phase).toBe('cancelled');
    mgr.reset();
    expect(mgr.getSnapshot()).toMatchObject({
      phase: 'idle',
      turnId: null,
      stage: '',
      step: 0,
    });
  });
});
