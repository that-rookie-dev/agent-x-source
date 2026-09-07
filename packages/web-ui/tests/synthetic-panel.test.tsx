// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api.js', async () => ({
  getAuthToken: () => '',
  capabilities: {
    list: vi.fn(async () => ({ capabilities: [], stats: { total: 0, byStatus: {}, byKind: {} } })),
    observations: vi.fn(async () => ({ observations: [] })),
    settings: vi.fn(async () => ({ settings: { enabled: false } })),
    saveTestCase: vi.fn(async () => ({ testCase: { id: 'tc1' } })),
    runAllTests: vi.fn(async () => ({ results: [] })),
    test: vi.fn(async () => ({ result: { passed: true } })),
    runTestCase: vi.fn(async () => ({ result: { passed: true } })),
  },
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineOverview } from '../src/components/synthetic/PipelineOverview.js';
import { ObservationFeed } from '../src/components/synthetic/ObservationFeed.js';
import { ProposalReviewCard } from '../src/components/synthetic/ProposalReviewCard.js';
import { GraduationPipelineChart } from '../src/components/synthetic/GraduationPipelineChart.js';
import { CapabilityHelp } from '../src/components/synthetic/CapabilityHelp.js';
import { CapabilityList } from '../src/components/synthetic/CapabilityList.js';
import { ConsentDialog } from '../src/components/synthetic/ConsentDialog.js';
import { ApprovalWorkflow } from '../src/components/synthetic/ApprovalWorkflow.js';
import { CapabilityPlayground } from '../src/components/synthetic/CapabilityPlayground.js';
import type { CapabilityRecord, ObservedPatternRecord } from '../src/api.js';

describe('SI dashboard widgets', () => {
  it('renders pipeline stat cards with counts', () => {
    render(
      <PipelineOverview
        stats={{ total: 8, byStatus: { proposed: 3, registered: 5 }, byKind: { skill: 8 } }}
        pending={3}
        recent={[]}
        onFilter={() => undefined}
        onReview={() => undefined}
      />,
    );
    expect(screen.getByText((_, node) => node?.tagName === 'P' && node?.textContent === '3 proposals awaiting review')).toBeTruthy();
    expect(screen.getByText('Review now')).toBeTruthy();
  });

  it('renders observation rows and actions', () => {
    const row: ObservedPatternRecord = {
      id: 'o1',
      pattern: 'repeated tool shell_exec',
      frequency: 4,
      firstObservedAt: Date.now(),
      lastObservedAt: Date.now(),
      context: 'format logs',
      confidence: 0.8,
      origin: 'autonomous',
    };
    render(
      <ObservationFeed
        observations={[row]}
        onAcknowledge={() => undefined}
        onIgnore={() => undefined}
        onGenerate={() => undefined}
      />,
    );
    expect(screen.getByText('repeated tool shell_exec')).toBeTruthy();
    expect(screen.getByText('Acknowledge')).toBeTruthy();
  });

  it('renders proposal approve/reject buttons', () => {
    const item = {
      id: 'c1',
      kind: 'skill',
      name: 'log-formatter',
      description: 'format logs',
      createdAt: 1,
      updatedAt: 1,
      createdBy: 'u',
      sourceSessionId: '',
      version: 1,
      origin: 'user-prompt',
      status: 'proposed',
      useCount: 0,
      trialCount: 0,
      promptTemplate: 'Format logs',
      triggerPattern: 'log',
      exampleCalls: [],
    } as CapabilityRecord;
    render(
      <ProposalReviewCard
        item={item}
        onApprove={() => undefined}
        onReject={() => undefined}
        onTest={() => undefined}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText('log-formatter')).toBeTruthy();
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Reject')).toBeTruthy();
  });

  it('chart click reports the selected status', () => {
    let selected = '';
    render(<GraduationPipelineChart byStatus={{ proposed: 2 }} onSelect={(s) => { selected = s; }} />);
    fireEvent.click(screen.getByLabelText('Proposed 2'));
    expect(selected).toBe('proposed');
  });

  it('filters and sorts CapabilityList', () => {
    const items: CapabilityRecord[] = [
      { id: 'c1', kind: 'tool', name: 'alpha', description: 'a', status: 'proposed', createdAt: 1, updatedAt: 1, createdBy: 't', sourceSessionId: '', version: 1, origin: 'observed', useCount: 5, trialCount: 0 },
      { id: 'c2', kind: 'skill', name: 'beta', description: 'b', status: 'registered', createdAt: 2, updatedAt: 2, createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', useCount: 1, trialCount: 0 },
    ] as CapabilityRecord[];
    render(<CapabilityList items={items} onOpen={() => undefined} onExport={() => undefined} />);

    fireEvent.change(screen.getByLabelText('Filter kind'), { target: { value: 'tool' } });
    expect(screen.queryByText('beta')).toBeNull();
    expect(screen.getByText('alpha')).toBeTruthy();

    fireEvent.click(screen.getByText('name'));
    expect(screen.getByText('alpha')).toBeTruthy();
  });

  it('renders help FAQ and empty list', () => {
    render(<CapabilityHelp />);
    expect(screen.getByText('What lives in Capabilities?')).toBeTruthy();
    render(<CapabilityList items={[]} onOpen={() => undefined} />);
    expect(screen.getByText(/No generated tools yet/)).toBeTruthy();
  });

  it('renders consent choices', () => {
    render(<ConsentDialog open onChoose={() => undefined} />);
    expect(screen.getByText('Allow autonomous proposals')).toBeTruthy();
    expect(screen.getByText('No autonomous proposals')).toBeTruthy();
  });

  it('saves a test case from the playground', async () => {
    const item = { id: 'c1', kind: 'tool', name: 'csv-tool', description: 'd', status: 'registered', createdAt: 1, updatedAt: 1, createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', useCount: 0, trialCount: 0 } as CapabilityRecord;
    let saved = false;
    render(<CapabilityPlayground item={item} testCases={[]} onSaved={() => { saved = true; }} />);
    fireEvent.click(screen.getByText('Save as test case'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(saved).toBe(true);
  });

  it('requires a reason to reject in ApprovalWorkflow', () => {
    render(<ApprovalWorkflow open name="bad" mode="reject" onClose={() => undefined} onConfirm={() => undefined} />);
    const confirm = screen.getByText('Confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });
});
