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
import { PanelHeader } from './PanelHeader';
import { orchestrator, type OrchestratorPlan, type OrchestratorStep } from '../api';
import { colors } from '../theme';

export function OrchestratorPanel() {
  const [goal, setGoal] = useState('');
  const [plan, setPlan] = useState<OrchestratorPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreatePlan = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setError('');
    try {
      const p = await orchestrator.createPlan(goal);
      setPlan(p);
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
      const p = await orchestrator.execute(plan.id);
      setPlan(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Execution failed');
    } finally {
      setLoading(false);
    }
  };

  const stepColor = (status: OrchestratorStep['status']) => {
    switch (status) {
      case 'done': return colors.accent.green;
      case 'executing': return colors.accent.orange;
      case 'failed': return colors.accent.red;
      default: return colors.text.dim;
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelHeader
        title="Multi-Agent Orchestrator"
        subtitle="Break complex goals into sub-agent tasks with dependency tracking"
        icon={<AccountTreeIcon sx={{ fontSize: 20 }} />}
      />
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
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
    </Box>
  );
}
