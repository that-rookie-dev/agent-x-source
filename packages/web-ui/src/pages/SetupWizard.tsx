import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BadgeIcon from '@mui/icons-material/Badge';
import { providers as provApi, models as modelsApi, config } from '../api';
import { useApp } from '../store/AppContext';
import { useGlobalError } from '../components/ErrorBand';
import { colors } from '../theme';
import type { ProviderInfo, ModelInfo } from '../api';

const STEPS = ['Provider', 'API Key', 'Model', 'Callsign', 'Complete'];
const STORAGE_KEY = 'agentx_wizard_progress';

interface WizardProgress {
  step: number;
  selectedProvider: string;
  selectedModel: string;
  callsign: string;
}

function saveProgress(data: WizardProgress) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

function loadProgress(): WizardProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as WizardProgress : null;
  } catch { return null; }
}

function clearProgress() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function SetupWizard() {
  const { setConfig, setAuthState } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const { showError, clearError } = useGlobalError();
  const [loading, setLoading] = useState(false);
  const [showBackWarning, setShowBackWarning] = useState(false);

  // Wizard state
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [callsign, setCallsign] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);

  // Restore progress on mount
  useEffect(() => {
    const saved = loadProgress();
    if (saved && saved.step >= 2) {
      setStep(saved.step);
      setSelectedProvider(saved.selectedProvider);
      setSelectedModel(saved.selectedModel);
      setCallsign(saved.callsign || '');
      // Re-fetch models for restored provider
      if (saved.selectedProvider) {
        setModelsLoading(true);
        provApi.models(saved.selectedProvider).then((m) => { setAvailableModels(m); setModelsLoading(false); }).catch(() => { setModelsLoading(false); });
      }
    }
    // Ensure providers are loaded
    provApi.available().then((p) => setAvailableProviders(p.filter(Boolean))).catch(() => {
      showError('Failed to load providers. Check if the server is running.');
    });
  }, []);

  // Load providers on mount (if not loaded by restore)
  useEffect(() => {
    if (availableProviders.length === 0 && !loading) {
      setLoading(true);
      provApi.available().then((p) => { setAvailableProviders(p.filter(Boolean)); setLoading(false); }).catch(() => {
        showError('Cannot reach the server. Make sure Agent-X daemon is running.');
        setLoading(false);
      });
    }
  }, []);

  // Persist progress on step change (only non-sensitive data)
  const persistProgress = useCallback(() => {
    if (step >= 2) {
      saveProgress({ step, selectedProvider, selectedModel, callsign });
    }
  }, [step, selectedProvider, selectedModel, callsign]);

  useEffect(() => { persistProgress(); }, [persistProgress]);

  const next = () => { clearError(); setStep((s) => s + 1); };
  const back = () => {
    clearError();
    // If going back to step 0 or 1 from step 2+, warn about losing credentials
    if (step >= 2 && step <= 1) {
      // This won't trigger since step >= 2 means back goes to 1 at minimum
    }
    setStep((s) => s - 1);
  };

  const handleBackToCredentials = () => {
    // From step 2+ going back to step 1 means re-entering API key
    setShowBackWarning(true);
  };

  const confirmBackToCredentials = () => {
    setShowBackWarning(false);
    setApiKey('');
    setBaseUrl('');
    setAvailableModels([]);
    setSelectedModel('');
    clearProgress();
    setStep(1);
  };

  const selectedProviderInfo = availableProviders.find(p => p.id === selectedProvider);
  const isLocal = selectedProviderInfo?.type === 'local';
  const isAzure = selectedProvider === 'azure';

  const handleProviderNext = () => {
    if (!selectedProvider) { showError('Select a provider'); return; }
    // Pre-fill base URL for local providers
    if (selectedProviderInfo?.type === 'local' && !baseUrl) {
      setBaseUrl(selectedProviderInfo.defaultBaseUrl ?? '');
    }
    next();
  };

  const handleApiKeyNext = async () => {
    if (!isLocal && !apiKey) { showError('Enter your API key'); return; }
    if (isAzure && !baseUrl) { showError('Azure requires a resource endpoint URL'); return; }
    setLoading(true);
    try {
      const result = await provApi.validate(selectedProvider, apiKey || undefined, baseUrl || undefined);
      if (!result.valid) { showError(result.error ?? 'Invalid API key'); setLoading(false); return; }
      await provApi.configure(selectedProvider, apiKey || undefined, baseUrl || undefined);
      // Load models
      const modelList = await provApi.models(selectedProvider);
      setAvailableModels(modelList);
      next();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleModelNext = async () => {
    if (!selectedModel) { showError('Select a model'); return; }
    setLoading(true);
    try {
      await modelsApi.switch(selectedModel);
      next();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Model switch failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCallsignNext = () => {
    next();
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const result = await config.update({ setupComplete: true, user: { callsign } });
      if (!result.ok) {
        showError('Failed to save setup. Config may be read-only. Ensure Docker volume mount is writable: remove :ro from config mount in docker-compose.yml.');
        setLoading(false);
        return;
      }
      const cfg = await config.get();
      setConfig(cfg);
      setAuthState('authenticated');
      clearProgress();
      navigate('/');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Setup could not be saved. Please check your configuration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: '#000' }}>
      {/* Fixed Header */}
      <Box sx={{ flexShrink: 0, textAlign: 'center', pt: 4, px: 2, pb: 2 }}>
        <Typography variant="h2" sx={{ mb: 1 }}>SETUP WIZARD</Typography>
        <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 3 }}>
          Configure your Agent-X instance
        </Typography>

        <Stepper activeStep={step} alternativeLabel sx={{ width: '100%', maxWidth: 700, mx: 'auto' }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel sx={{ '& .MuiStepLabel-label': { color: colors.text.dim, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" } }}>
                {label}
              </StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {/* Scrollable Content */}
      <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', px: 2 }}>
        <Box sx={{ width: '100%', maxWidth: (step === 0 || step === 2) ? 720 : 480 }}>
          <Box sx={{ pt: 0, pb: 2 }}>

          {/* Step 0: Choose Provider */}
          {step === 0 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 0.5, textAlign: 'center' }}>Choose AI Provider</Typography>
              <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: colors.text.dim, mb: 2, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px' }}>
                CLOUD
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
                {availableProviders.filter(Boolean).filter(p => p.type === 'cloud').map((p) => (
                  <Box
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    sx={{
                      p: 1.5,
                      border: `1px solid ${selectedProvider === p.id ? colors.accent.blue : colors.border.default}`,
                      borderRadius: 1,
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.2s ease',
                      bgcolor: selectedProvider === p.id ? colors.accent.blue : 'transparent',
                      boxShadow: selectedProvider === p.id ? `0 0 12px ${colors.accent.blue}40` : 'none',
                      '&:hover': selectedProvider === p.id ? {} : { borderColor: colors.border.strong, bgcolor: colors.bg.tertiary },
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: selectedProvider === p.id ? '#000' : colors.text.primary }}>{p.name}</Typography>
                  </Box>
                ))}
              </Box>
              <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: colors.text.dim, mb: 1.5, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px' }}>
                LOCAL
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5 }}>
                {availableProviders.filter(Boolean).filter(p => p.type === 'local').map((p) => (
                  <Box
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    sx={{
                      p: 1.5,
                      border: `1px solid ${selectedProvider === p.id ? colors.accent.green : colors.border.default}`,
                      borderRadius: 1,
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.2s ease',
                      bgcolor: selectedProvider === p.id ? colors.accent.green : 'transparent',
                      boxShadow: selectedProvider === p.id ? `0 0 12px ${colors.accent.green}40` : 'none',
                      '&:hover': selectedProvider === p.id ? {} : { borderColor: colors.border.strong, bgcolor: colors.bg.tertiary },
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: selectedProvider === p.id ? '#000' : colors.text.primary }}>{p.name}</Typography>
                  </Box>
                ))}
              </Box>
              {availableProviders.length === 0 && (
                <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 2 }}>Loading providers...</Typography>
              )}
            </Box>
          )}

          {/* Step 1: API Key / Connection */}
          {step === 1 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {isLocal ? 'Connection Settings' : isAzure ? 'Azure Configuration' : 'Enter API Key'}
              </Typography>
              <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2 }}>
                {isLocal
                  ? `Configure your ${selectedProviderInfo?.name ?? 'local'} endpoint`
                  : isAzure
                    ? 'Enter your Azure resource endpoint and API key'
                    : `Enter your ${selectedProviderInfo?.name ?? ''} API key`}
              </Typography>
              {!isLocal && (
                <TextField label="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} fullWidth type="password" sx={{ mb: 2 }} />
              )}
              {isLocal && (
                <TextField label="API Key (optional)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} fullWidth type="password" sx={{ mb: 2 }} placeholder="Leave blank if not required" />
              )}
              {(isLocal || isAzure) && (
                <TextField
                  label={isAzure ? 'Resource Endpoint URL' : 'Base URL'}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  fullWidth
                  placeholder={selectedProviderInfo?.defaultBaseUrl ?? ''}
                  required={isAzure}
                />
              )}
            </Box>
          )}

          {/* Step 2: Choose Model */}
          {step === 2 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 0.5 }}>Select Model</Typography>
              <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2 }}>
                {availableModels.length} model{availableModels.length !== 1 ? 's' : ''} available from {selectedProviderInfo?.name ?? selectedProvider}
              </Typography>
              {modelsLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 4 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" sx={{ color: colors.text.dim }}>Loading models...</Typography>
                </Box>
              ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1.5 }}>
                {availableModels.filter(Boolean).map((m) => (
                  <Box
                    key={m.id}
                    onClick={() => setSelectedModel(m.id)}
                    sx={{
                      p: 1.5,
                      border: `1px solid ${selectedModel === m.id ? colors.accent.blue : colors.border.default}`,
                      borderRadius: 1,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      bgcolor: selectedModel === m.id ? colors.accent.blue : 'transparent',
                      boxShadow: selectedModel === m.id ? `0 0 12px ${colors.accent.blue}40` : 'none',
                      '&:hover': selectedModel === m.id ? {} : { borderColor: colors.border.strong, bgcolor: colors.bg.tertiary },
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.78rem', color: selectedModel === m.id ? '#000' : colors.text.primary, mb: 0.5, wordBreak: 'break-word' }}>
                      {m.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      {m.contextWindow && (
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace", color: selectedModel === m.id ? '#000000aa' : colors.text.dim }}>
                          {m.contextWindow >= 1000000 ? `${(m.contextWindow / 1000000).toFixed(1)}M` : `${Math.round(m.contextWindow / 1000)}K`} ctx
                        </Typography>
                      )}
                      {m.capabilities && m.capabilities.length > 0 && m.capabilities.filter(c => c !== 'text' && c !== 'streaming').map((cap) => (
                        <Typography key={cap} variant="caption" sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: selectedModel === m.id ? '#000000aa' : colors.accent.cyan, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {cap}
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
            </Box>
          )}

          {/* Step 3: Callsign */}
          {step === 3 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 1 }}>Your Callsign</Typography>
              <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2 }}>
                How should Agent-X address you?
              </Typography>
              <TextField label="Callsign" value={callsign} onChange={(e) => setCallsign(e.target.value)} fullWidth placeholder="e.g. Commander" />

              <Box sx={{ mt: 4, p: 2.5, border: `1px solid ${colors.border.default}`, borderRadius: 1, bgcolor: colors.bg.secondary }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                  <BadgeIcon sx={{ fontSize: 20, color: colors.accent.blue }} />
                  <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px', fontSize: '0.75rem' }}>
                    WHAT IS A CALLSIGN?
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ color: colors.text.secondary, fontSize: '0.8rem', lineHeight: 1.6 }}>
                  Your unique identity within Agent-X. The agent uses this to address you
                  in conversations, logs, and notifications.
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem' }}>
                  Examples: Commander, Captain, Architect, Operator
                </Typography>
              </Box>
            </Box>
          )}

          {/* Step 4: Complete */}
          {step === 4 && (
            <Box sx={{ textAlign: 'center' }}>
              <CheckCircleIcon sx={{ fontSize: 64, color: colors.accent.green, mb: 2 }} />
              <Typography variant="h5" sx={{ mb: 1 }}>Setup Complete!</Typography>
              <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 3 }}>
                Your Agent-X instance is ready. Launch the console to start chatting.
              </Typography>
              <Box sx={{ textAlign: 'left', p: 2, border: `1px solid ${colors.border.default}`, borderRadius: 1, mb: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem' }}>
                <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Provider: {selectedProvider}</Typography>
                <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Model: {selectedModel}</Typography>
                <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Callsign: {callsign || '(not set)'}</Typography>
              </Box>
            </Box>
          )}
        </Box>
        </Box>
      </Box>

      {/* Fixed Bottom Navigation */}
      <Box sx={{ flexShrink: 0, borderTop: `1px solid ${colors.border.default}`, px: 2, py: 2, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: '100%', maxWidth: (step === 0 || step === 2) ? 720 : 480, display: 'flex', justifyContent: step === 0 ? 'flex-end' : step === 4 ? 'center' : 'space-between' }}>
          {step === 1 && (
            <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>
          )}
          {step === 2 && (
            <Button onClick={handleBackToCredentials} sx={{ color: colors.text.secondary }}>Back</Button>
          )}
          {step === 3 && (
            <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>
          )}
          {step === 0 && (
            <Button variant="contained" onClick={handleProviderNext} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
              Next
            </Button>
          )}
          {step === 1 && (
            <Button variant="contained" onClick={handleApiKeyNext} disabled={loading} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
              {loading ? 'Validating...' : 'Validate & Next'}
            </Button>
          )}
          {step === 2 && (
            <Button variant="contained" onClick={handleModelNext} disabled={loading || !selectedModel} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
              {loading ? 'Switching...' : 'Next'}
            </Button>
          )}
          {step === 3 && (
            <Button variant="contained" onClick={handleCallsignNext} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
              {callsign.trim() ? 'Next' : 'Skip & Next'}
            </Button>
          )}
          {step === 4 && (
            <Button variant="contained" onClick={handleComplete} disabled={loading} sx={{ px: 5, py: 1.2, bgcolor: colors.text.primary, color: colors.bg.primary, fontWeight: 700 }}>
              {loading ? 'Finalizing...' : 'Launch Console'}
            </Button>
          )}
        </Box>
      </Box>

      {/* Back Warning Dialog */}
      <Dialog
        open={showBackWarning}
        onClose={() => setShowBackWarning(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxWidth: 400 } }}
      >
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, letterSpacing: '1px', pb: 1 }}>
          RE-ENTER CREDENTIALS?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: colors.text.secondary, fontSize: '0.8rem', lineHeight: 1.6 }}>
            Going back will clear your API key and connection settings for security.
            You will need to re-enter and validate them again.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setShowBackWarning(false)} sx={{ color: colors.text.dim }}>Cancel</Button>
          <Button onClick={confirmBackToCredentials} variant="contained" sx={{ bgcolor: colors.accent.red, color: '#fff', '&:hover': { bgcolor: '#d63a33' } }}>
            Clear & Go Back
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal loader overlay — doesn't disrupt wizard layout */}
      {loading && (
        <Box sx={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
        }}>
          <CircularProgress size={40} sx={{ color: '#fff' }} />
        </Box>
      )}
    </Box>
  );
}
