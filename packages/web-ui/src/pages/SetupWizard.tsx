import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Chip from '@mui/material/Chip';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { providers as provApi, models as modelsApi, crews, config, bridges } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';
import type { ProviderInfo, ModelInfo } from '../api';

const STEPS = ['Provider', 'API Key', 'Model', 'Callsign', 'Crew', 'Bridges', 'Complete'];

export function SetupWizard() {
  const { setView, setConfig } = useApp();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Wizard state
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [callsign, setCallsign] = useState('');
  const [crewName, setCrewName] = useState('Default Crew');
  const [crewPrompt, setCrewPrompt] = useState('You are a helpful AI assistant.');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');

  // Load providers on mount
  useEffect(() => {
    provApi.available().then(setAvailableProviders).catch(() => {});
  }, []);

  const next = () => { setError(''); setStep((s) => s + 1); };
  const back = () => { setError(''); setStep((s) => s - 1); };

  const handleProviderNext = () => {
    if (!selectedProvider) { setError('Select a provider'); return; }
    next();
  };

  const handleApiKeyNext = async () => {
    if (!apiKey) { setError('Enter your API key'); return; }
    setLoading(true);
    try {
      const result = await provApi.validate(selectedProvider, apiKey, baseUrl || undefined);
      if (!result.valid) { setError(result.error ?? 'Invalid API key'); setLoading(false); return; }
      await provApi.configure(selectedProvider, apiKey, baseUrl || undefined);
      // Load models
      const modelList = await provApi.models(selectedProvider);
      setAvailableModels(modelList);
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleModelNext = async () => {
    if (!selectedModel) { setError('Select a model'); return; }
    setLoading(true);
    try {
      await modelsApi.switch(selectedModel);
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model switch failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCallsignNext = () => {
    if (!callsign.trim()) { setError('Enter a callsign'); return; }
    next();
  };

  const handleCrewNext = async () => {
    if (!crewName.trim()) { setError('Enter a crew name'); return; }
    setLoading(true);
    try {
      await crews.create({ name: crewName, systemPrompt: crewPrompt });
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Crew creation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBridgesNext = async () => {
    setLoading(true);
    try {
      if (telegramToken.trim()) {
        await bridges.telegram.start(telegramToken, telegramChatId || undefined);
      }
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bridge setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      await config.update({ setupComplete: true, user: { callsign } });
      const cfg = await config.get();
      setConfig(cfg);
      setView('docking');
    } catch {
      setView('docking');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 6, px: 2, overflow: 'auto' }}>
      <Typography variant="h2" sx={{ mb: 1 }}>SETUP WIZARD</Typography>
      <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 4 }}>
        Configure your Agent-X instance
      </Typography>

      <Stepper activeStep={step} alternativeLabel sx={{ width: '100%', maxWidth: 700, mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel sx={{ '& .MuiStepLabel-label': { color: colors.text.dim, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" } }}>
              {label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ width: '100%', maxWidth: 480 }}>
        {error && <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000', border: `1px solid ${colors.accent.red}40` }}>{error}</Alert>}

        {/* Step 0: Choose Provider */}
        {step === 0 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>Choose AI Provider</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {availableProviders.map((p) => (
                <Box
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  sx={{
                    p: 2, border: `1px solid ${selectedProvider === p.id ? colors.accent.blue : colors.border.default}`,
                    borderRadius: 1, cursor: 'pointer', transition: 'border-color 0.2s',
                    '&:hover': { borderColor: colors.accent.blue },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>{p.name}</Typography>
                      <Typography variant="caption" sx={{ color: colors.text.tertiary }}>{p.description}</Typography>
                    </Box>
                    <Chip size="small" label={p.type} sx={{ fontSize: '0.6rem', textTransform: 'uppercase' }} />
                  </Box>
                </Box>
              ))}
              {availableProviders.length === 0 && (
                <Typography variant="body2" sx={{ color: colors.text.dim }}>Loading providers...</Typography>
              )}
            </Box>
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="contained" onClick={handleProviderNext} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
                Next
              </Button>
            </Box>
          </Box>
        )}

        {/* Step 1: API Key */}
        {step === 1 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>Enter API Key</Typography>
            <TextField label="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} fullWidth type="password" sx={{ mb: 2 }} />
            <TextField label="Base URL (optional)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} fullWidth placeholder="Leave blank for default" />
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>
              <Button variant="contained" onClick={handleApiKeyNext} disabled={loading} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
                {loading ? 'Validating...' : 'Validate & Next'}
              </Button>
            </Box>
          </Box>
        )}

        {/* Step 2: Choose Model */}
        {step === 2 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>Select Model</Typography>
            <FormControl fullWidth>
              <InputLabel>Model</InputLabel>
              <Select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} label="Model">
                {availableModels.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.name}{m.contextWindow ? ` (${Math.round(m.contextWindow / 1000)}k ctx)` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>
              <Button variant="contained" onClick={handleModelNext} disabled={loading} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
                {loading ? 'Switching...' : 'Next'}
              </Button>
            </Box>
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
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>
              <Button variant="contained" onClick={handleCallsignNext} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>Next</Button>
            </Box>
          </Box>
        )}

        {/* Step 4: Crew */}
        {step === 4 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>Create Default Crew</Typography>
            <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2 }}>
              A crew defines the agent's personality and system prompt.
            </Typography>
            <TextField label="Crew Name" value={crewName} onChange={(e) => setCrewName(e.target.value)} fullWidth sx={{ mb: 2 }} />
            <TextField label="System Prompt" value={crewPrompt} onChange={(e) => setCrewPrompt(e.target.value)} fullWidth multiline rows={4} />
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>
              <Button variant="contained" onClick={handleCrewNext} disabled={loading} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
                {loading ? 'Creating...' : 'Next'}
              </Button>
            </Box>
          </Box>
        )}

        {/* Step 5: Bridges (optional) */}
        {step === 5 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>Telegram Bridge (Optional)</Typography>
            <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2 }}>
              Connect a Telegram bot to chat with Agent-X on the go. Skip to finish setup without.
            </Typography>
            <TextField label="Bot Token" value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} fullWidth sx={{ mb: 2 }} />
            <TextField label="Chat ID (optional)" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} fullWidth />
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>
              <Button variant="contained" onClick={handleBridgesNext} disabled={loading} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>
                {loading ? 'Connecting...' : telegramToken ? 'Connect & Next' : 'Skip & Next'}
              </Button>
            </Box>
          </Box>
        )}

        {/* Step 6: Complete */}
        {step === 6 && (
          <Box sx={{ textAlign: 'center' }}>
            <CheckCircleIcon sx={{ fontSize: 64, color: colors.accent.green, mb: 2 }} />
            <Typography variant="h5" sx={{ mb: 1 }}>Setup Complete!</Typography>
            <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 3 }}>
              Your Agent-X instance is ready. Launch the console to start chatting.
            </Typography>
            <Box sx={{ textAlign: 'left', p: 2, border: `1px solid ${colors.border.default}`, borderRadius: 1, mb: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem' }}>
              <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Provider: {selectedProvider}</Typography>
              <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Model: {selectedModel}</Typography>
              <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Callsign: {callsign}</Typography>
              <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Crew: {crewName}</Typography>
              {telegramToken && <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Telegram: Connected</Typography>}
            </Box>
            <Button variant="contained" onClick={handleComplete} disabled={loading} sx={{ px: 5, py: 1.2, bgcolor: colors.text.primary, color: colors.bg.primary, fontWeight: 700 }}>
              {loading ? 'Finalizing...' : 'Launch Console'}
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
