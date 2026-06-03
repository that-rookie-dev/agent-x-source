import { useState } from 'react';
import type { PlanState } from '../App';

interface PlanViewProps {
  plan: PlanState;
  onApprove: () => void;
  onReject: () => void;
  onStepApprove: (stepId: string) => void;
  onStepSkip: (stepId: string) => void;
  onStepModify: (stepId: string, modification: string) => void;
}

const stepStatusIcons: Record<string, string> = {
  pending: 'codicon-circle-outline',
  approved: 'codicon-check',
  executing: 'codicon-loading codicon-modifier-spin',
  done: 'codicon-pass-filled',
  failed: 'codicon-error',
  skipped: 'codicon-arrow-right',
};

export function PlanView({ plan, onApprove, onReject, onStepApprove, onStepSkip, onStepModify }: PlanViewProps) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [modification, setModification] = useState('');

  const completedSteps = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const progressPct = plan.steps.length > 0 ? Math.round((completedSteps / plan.steps.length) * 100) : 0;
  const isPending = plan.status === 'pending';
  const isExecuting = plan.status === 'executing';

  const handleSubmitModification = (stepId: string) => {
    if (modification.trim()) {
      onStepModify(stepId, modification.trim());
      setModification('');
      setEditingStep(null);
    }
  };

  return (
    <div className="plan-view">
      <div className="plan-header">
        <span className="codicon codicon-checklist" />
        <span className="plan-title">{plan.title}</span>
        <span className={`plan-status plan-status-${plan.status}`}>{plan.status}</span>
      </div>
      <div className="plan-progress">
        <div className="plan-progress-bar">
          <div className="plan-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="plan-progress-text">{completedSteps}/{plan.steps.length} steps</span>
      </div>
      <div className="plan-steps">
        {plan.steps.map((step, index) => (
          <div key={step.stepId} className={`plan-step plan-step-${step.status}`}>
            <div className="plan-step-header">
              <span className={`plan-step-icon codicon ${stepStatusIcons[step.status] || stepStatusIcons.pending}`} />
              <span className="plan-step-number">{index + 1}.</span>
              <span className="plan-step-description">{step.description}</span>
            </div>
            {step.result && <div className="plan-step-result">{step.result}</div>}
            {step.error && <div className="plan-step-error">{step.error}</div>}
            {isExecuting && step.status === 'pending' && (
              <div className="plan-step-actions">
                <button className="plan-step-btn plan-step-btn-approve" onClick={() => onStepApprove(step.stepId)}>Approve</button>
                <button className="plan-step-btn plan-step-btn-skip" onClick={() => onStepSkip(step.stepId)}>Skip</button>
                <button className="plan-step-btn plan-step-btn-modify"
                  onClick={() => setEditingStep(editingStep === step.stepId ? null : step.stepId)}>Modify</button>
              </div>
            )}
            {editingStep === step.stepId && (
              <div className="plan-step-modify">
                <input type="text" className="plan-step-modify-input" value={modification}
                  onChange={(e) => setModification(e.target.value)} placeholder="Describe modification..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitModification(step.stepId);
                    if (e.key === 'Escape') { setEditingStep(null); setModification(''); }
                  }} autoFocus />
                <button className="plan-step-btn" onClick={() => handleSubmitModification(step.stepId)}>Apply</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {isPending && (
        <div className="plan-actions">
          <button className="plan-btn plan-btn-approve" onClick={onApprove}>
            <span className="codicon codicon-check-all" /> Approve Plan
          </button>
          <button className="plan-btn plan-btn-reject" onClick={onReject}>
            <span className="codicon codicon-close-all" /> Reject Plan
          </button>
        </div>
      )}
    </div>
  );
}
