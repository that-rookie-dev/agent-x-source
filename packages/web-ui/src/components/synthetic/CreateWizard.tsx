import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Fade from '@mui/material/Fade';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import { colors, MONO, alphaColor } from '../../theme';
import { capabilities, type CapabilityRecord } from '../../api';

type Step = 'describe' | 'clarify' | 'preview' | 'test' | 'approve';
const STEPS: Step[] = ['describe', 'clarify', 'preview', 'test', 'approve'];

const STEP_LABELS: Record<Step, string> = {
  describe: 'Describe',
  clarify: 'Clarify',
  preview: 'Preview',
  test: 'Test',
  approve: 'Approve',
};

const KIND_DETAILS: Record<'skill' | 'tool' | 'knowledge' | 'auto', { title: string; description: string; example: string }> = {
  skill: {
    title: 'Prompt-recipe skill',
    description:
      'A reusable instruction pattern the agent follows when it sees a matching situation. It does not run code — it shapes how the agent responds. Good for repeated phrasing, formatting, or decision rules.',
    example:
      'Example: “Whenever I paste a meeting transcript, summarize it into action items and format them as a Markdown checklist.”',
  },
  tool: {
    title: 'Generated tool',
    description:
      'A small executable (TypeScript / Python / Bash) that runs in a local process sandbox. Great for parsing, converting, calculating, or talking to a local file. You approve it before the agent can call it.',
    example:
      'Example: “Extract all email addresses from a pasted block of text and return them as a JSON array.”',
  },
  knowledge: {
    title: 'Knowledge entry',
    description:
      'Non-executable reference material with a domain and source references. The agent can cite it for factual grounding without running any code.',
    example:
      'Example: “Our release checklist: confirm tests pass, bump the version, update the changelog, and tag the commit.”',
  },
  auto: {
    title: 'Auto-detect',
    description:
      'Agent-X reads your description and picks the best kind — skill, tool, or knowledge — before generating. Use this when you are not sure which one fits.',
    example:
      'Example: “Take a pasted error log and tell me the root cause, then suggest the next troubleshooting step.”',
  },
};

export function CreateWizard({
  onCreated,
}: {
  onCreated: (item: CapabilityRecord) => void;
}) {
  const [step, setStep] = useState<Step>('describe');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<'skill' | 'tool' | 'knowledge' | 'auto'>('skill');
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState('');
  const [item, setItem] = useState<CapabilityRecord | null>(null);
  const [testOut, setTestOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const composed = answers.trim() ? `${prompt.trim()}\nClarifications:\n${answers.trim()}` : prompt.trim();

  const goClarify = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await capabilities.clarify(prompt.trim());
      setQuestions(result.questions);
      if (result.inferredKind === 'tool' || result.inferredKind === 'skill' || result.inferredKind === 'knowledge') {
        setKind(result.inferredKind);
      }
      setStep('clarify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clarify failed');
    } finally {
      setBusy(false);
    }
  };

  const goPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const { proposal } = await capabilities.generate({ prompt: composed, kind });
      setItem(proposal.proposedCapability);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (!item || item.kind !== 'tool') {
      setStep('approve');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { result } = await capabilities.sandbox(item.id);
      setTestOut(JSON.stringify(result, null, 2));
      const refreshed = await capabilities.get(item.id);
      setItem(refreshed.capability);
      setStep('test');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sandbox failed');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await capabilities.approve(item.id, 'registration');
      const refreshed = await capabilities.get(item.id);
      onCreated(refreshed.capability);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', py: 1 }}>
      <Stepper
        activeStep={stepIndex}
        alternativeLabel
        sx={{
          mb: 2,
          '& .MuiStepLabel-label': { fontFamily: MONO, fontSize: '0.62rem', color: colors.text.dim, textTransform: 'uppercase' },
          '& .MuiStepLabel-active .MuiStepLabel-label': { color: colors.accent.blue, fontWeight: 600 },
          '& .MuiStepIcon-root': { color: colors.border.strong, fontSize: 20 },
          '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': { color: colors.accent.blue },
        }}
      >
        {STEPS.map((s) => (
          <Step key={s}>
            <StepLabel>{STEP_LABELS[s]}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Typography sx={{ color: colors.accent.red, fontSize: '0.72rem', fontFamily: MONO, mb: 1.5, p: 1, border: `1px solid ${colors.accent.red}`, borderRadius: 1, bgcolor: alphaColor(colors.accent.red, '08') }}>
          {error}
        </Typography>
      )}

      <Fade in timeout={250} key={step}>
        <Box>
          {step === 'describe' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={6}
                placeholder="Describe a reusable skill or tool…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                inputProps={{ 'aria-label': 'Capability description' }}
                sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem', fontFamily: MONO } }}
              />
              <Box
                sx={{
                  display: 'flex',
                  gap: 0.5,
                  p: 0.5,
                  border: `1px solid ${colors.border.default}`,
                  borderRadius: 1.5,
                  bgcolor: alphaColor(colors.bg.tertiary, '40'),
                }}
                aria-label="Capability kind"
              >
                {(['skill', 'tool', 'knowledge', 'auto'] as const).map((k) => (
                  <Button
                    key={k}
                    size="small"
                    onClick={() => setKind(k)}
                    sx={{
                      flex: 1,
                      minWidth: 64,
                      fontFamily: MONO,
                      fontSize: '0.62rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: kind === k ? colors.accent.blue : colors.text.dim,
                      bgcolor: kind === k ? alphaColor(colors.accent.blue, '14') : 'transparent',
                      border: `1px solid ${kind === k ? colors.accent.blue : colors.border.strong}`,
                      borderRadius: 1,
                      py: 0.65,
                      '&:hover': {
                        bgcolor: kind === k ? alphaColor(colors.accent.blue, '18') : alphaColor(colors.accent.blue, '08'),
                        borderColor: colors.accent.blue,
                      },
                    }}
                  >
                    {k}
                  </Button>
                ))}
              </Box>
              <Box
                sx={{
                  p: 1.25,
                  border: `1px solid ${colors.border.strong}`,
                  borderRadius: 1.5,
                  bgcolor: alphaColor(colors.bg.tertiary, '30'),
                }}
              >
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: '0.72rem',
                    color: colors.text.primary,
                    mb: 0.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {KIND_DETAILS[kind].title}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.secondary, lineHeight: 1.5, mb: 1 }}>
                  {KIND_DETAILS[kind].description}
                </Typography>
                <Typography
                  component="div"
                  sx={{
                    fontFamily: MONO,
                    fontSize: '0.62rem',
                    color: colors.text.dim,
                    lineHeight: 1.6,
                    p: 0.75,
                    border: `1px dashed ${colors.border.strong}`,
                    borderRadius: 0.5,
                    bgcolor: alphaColor(colors.bg.tertiary, '30'),
                  }}
                >
                  {KIND_DETAILS[kind].example}
                </Typography>
              </Box>
              <Button
                fullWidth
                size="small"
                disabled={busy || !prompt.trim()}
                onClick={() => void goClarify()}
                sx={{ fontFamily: MONO, fontSize: '0.7rem', textTransform: 'none', py: 0.75 }}
              >
                {busy ? 'Working…' : 'Next: clarify'}
              </Button>
            </Box>
          )}

          {step === 'clarify' && (
            <Box>
              {questions.length === 0 ? (
                <Typography sx={{ fontSize: '0.72rem', fontFamily: MONO, color: colors.text.secondary, mb: 1 }}>
                  Prompt looks specific enough. You can generate now.
                </Typography>
              ) : (
                <Box sx={{ mb: 1.5, p: 1, border: `1px solid ${colors.border.strong}`, borderRadius: 1, bgcolor: alphaColor(colors.bg.tertiary, '30') }}>
                  {questions.map((q) => (
                    <Typography key={q} sx={{ fontSize: '0.72rem', fontFamily: MONO, color: colors.text.secondary, mb: 0.5 }}>
                      • {q}
                    </Typography>
                  ))}
                </Box>
              )}
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={4}
                placeholder="Optional answers…"
                value={answers}
                onChange={(e) => setAnswers(e.target.value)}
                inputProps={{ 'aria-label': 'Clarifying answers' }}
                sx={{ mb: 1.5, '& .MuiInputBase-input': { fontSize: '0.75rem', fontFamily: MONO } }}
              />
              <Button
                fullWidth
                size="small"
                disabled={busy}
                onClick={() => void goPreview()}
                sx={{ fontFamily: MONO, fontSize: '0.7rem', textTransform: 'none', py: 0.75 }}
              >
                {busy ? 'Generating…' : 'Create capability'}
              </Button>
            </Box>
          )}

          {step === 'preview' && item && (
            <Box>
              <Box sx={{ p: 1.5, border: `1px solid ${colors.border.strong}`, borderRadius: 1.5, bgcolor: alphaColor(colors.bg.tertiary, '30'), mb: 1.5 }}>
                <Typography sx={{ fontSize: '0.85rem', fontFamily: MONO, color: colors.text.primary, fontWeight: 600 }}>{item.name}</Typography>
                <Typography sx={{ fontSize: '0.7rem', color: colors.text.secondary, mb: 1 }}>{item.description}</Typography>
                {item.kind === 'tool' && (
                  <Typography component="pre" sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
                    {item.sourceCode.slice(0, 800)}
                  </Typography>
                )}
                {item.kind === 'skill' && (
                  <Typography sx={{ fontSize: '0.68rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'pre-wrap' }}>
                    {item.promptTemplate.slice(0, 500)}
                  </Typography>
                )}
                {item.kind === 'knowledge' && (
                  <>
                    <Typography sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}>Domain: {item.domain}</Typography>
                    <Typography sx={{ fontSize: '0.68rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'pre-wrap' }}>
                      {item.content.slice(0, 600)}
                    </Typography>
                  </>
                )}
              </Box>
              <Button
                fullWidth
                size="small"
                disabled={busy}
                onClick={() => void (item.kind === 'tool' ? runTest() : setStep('approve'))}
                sx={{ fontFamily: MONO, fontSize: '0.7rem', textTransform: 'none', py: 0.75 }}
              >
                {item.kind === 'tool' ? 'Next: test sandbox' : 'Next: approve'}
              </Button>
            </Box>
          )}

          {step === 'test' && (
            <Box>
              <Box sx={{ p: 1.5, border: `1px solid ${colors.border.strong}`, borderRadius: 1.5, bgcolor: alphaColor(colors.bg.tertiary, '30'), mb: 1.5 }}>
                <Typography component="pre" sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'pre-wrap' }}>
                  {testOut ?? 'No sandbox output'}
                </Typography>
              </Box>
              <Button
                fullWidth
                size="small"
                onClick={() => setStep('approve')}
                sx={{ fontFamily: MONO, fontSize: '0.7rem', textTransform: 'none', py: 0.75 }}
              >
                Next: approve
              </Button>
            </Box>
          )}

          {step === 'approve' && item && (
            <Box>
              <Box sx={{ p: 1.5, border: `1px solid ${colors.border.strong}`, borderRadius: 1.5, bgcolor: alphaColor(colors.bg.tertiary, '30'), mb: 1.5 }}>
                <Typography sx={{ fontSize: '0.72rem', fontFamily: MONO, color: colors.text.secondary }}>
                  Register “{item.name}” so the agent can use it. Generated tools stay in a local process sandbox.
                </Typography>
              </Box>
              <Button
                fullWidth
                size="small"
                disabled={busy}
                onClick={() => void approve()}
                sx={{ fontFamily: MONO, fontSize: '0.7rem', textTransform: 'none', py: 0.75 }}
              >
                Approve
              </Button>
            </Box>
          )}
        </Box>
      </Fade>
    </Box>
  );
}
