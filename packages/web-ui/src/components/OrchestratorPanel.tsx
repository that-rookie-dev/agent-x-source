import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { colors } from '../theme';

interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'executing' | 'done' | 'failed';
  result?: string;
  dependsOn?: string[];
}

interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: 'created' | 'executing' | 'complete' | 'failed';
}

export function OrchestratorPanel() {
  const [goal, setGoal] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreatePlan = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/orchestrator/plan', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      const data = await res.json();
      setPlan(data.plan ?? data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Plan creation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!plan) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/orchestrator/plan/${plan.id}/execute`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Execution failed');
      const data = await res.json();
      setPlan(data.plan ?? { ...plan, status: 'complete' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Execution failed');
    } finally {
      setLoading(false);
    }
  };

  const stepColor = (status: PlanStep['status']) => {
    switch (status) {
      case 'done': return colors.accent.green;
      case 'executing': return colors.accent.orange;
      case 'failed': return colors.accent.red;
      default: return colors.text.dim;
    }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <AccountTreeIcon sx={{ color: colors.accent.purple }} />
        <Typography variant="h6">Multi-Agent Orchestrator</Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000' }}>{error}</Alert>}

      {/* Goal input */}
      <Box sx={{ mb: 3, p: 2, border: `1px solid ${colors.border.default}`, borderRadius: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, color: colors.text.secondary }}>Define Goal</Typography>
        <TextField
          fullWidth multiline rows={3} placeholder="Describe a complex multi-step goal for the orchestrator..."
          value={goal} onChange={(e) => setGoal(e.target.value)}
        />
        <Button size="small" variant="contained" onClick={handleCreatePlan} disabled={loading || !goal.trim()}
          sx={{ mt: 1, bgcolor: colors.accent.purple }}>
          {loading && !plan ? 'Planning...' : 'Create Plan'}
        </Button>
      </Box>

      {/* Plan visualization */}
      {plan && (
        <Box sx={{ p: 2, border: `1px solid ${colors.border.default}`, borderRadius: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ color: colors.text.primary }}>Plan: {plan.goal}</Typography>
              <Chip size="small" label={plan.status} sx={{
                mt: 0.5, fontSize: '0.6rem', textTransform: 'uppercase',
                color: plan.status === 'complete' ? colors.accent.green : plan.status === 'executing' ? colors.accent.orange : colors.text.dim,
              }} />
            </Box>
            {plan.status === 'created' && (
              <Button size="small" variant="contained" startIcon={loading ? <CircularProgress size={12} /> : <PlayArrowIcon />}
                onClick={handleExecute} disabled={loading}
                sx={{ bgcolor: colors.accent.green }}>
                Execute
              </Button>
            )}
          </Box>

          <Stepper orientation="vertical" activeStep={plan.steps.findIndex((s) => s.status === 'executing')}>
            {plan.steps.map((step) => (
              <Step key={step.id} completed={step.status === 'done'}>
                <StepLabel
                  error={step.status === 'failed'}
                  sx={{ '& .MuiStepLabel-label': { fontSize: '0.8rem', color: stepColor(step.status) } }}
                >
                  {step.description}
                  {step.dependsOn && step.dependsOn.length > 0 && (
                    <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>
                      Depends on: {step.dependsOn.join(', ')}
                    </Typography>
                  )}
                  {step.result && (
                    <Typography variant="caption" sx={{ display: 'block', color: colors.text.tertiary, fontFamily: "'JetBrains Mono', monospace", mt: 0.5 }}>
                      {step.result.slice(0, 200)}{step.result.length > 200 ? '...' : ''}
                    </Typography>
                  )}
                </StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      )}

      {!plan && !loading && (
        <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 4 }}>
          The orchestrator breaks complex goals into sub-agent tasks with dependency tracking.
        </Typography>
      )}
    </Box>
  );
}
