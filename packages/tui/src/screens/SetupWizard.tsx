import { type FC, useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { LoadingIndicator } from '../components/LoadingIndicator.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Banner } from '../components/Banner.js';
import {
  PROVIDERS,
  PROVIDER_IDS,
  type ProviderId,
  type ModelInfo,
  type AgentXConfig,
  resolveSpaceError,
  getLogger,
} from '@agentx/shared';
import { ConfigManager, ProviderFactory } from '@agentx/engine';

type WizardStep =
  | 'provider'
  | 'apikey'
  | 'baseurl'
  | 'validating'
  | 'models'
  | 'fetching_models'
  | 'complete'
  | 'cancel_confirm';

interface SetupWizardProps {
  onComplete: (config: AgentXConfig) => void;
  onCancel: () => void;
}

export const SetupWizard: FC<SetupWizardProps> = ({ onComplete, onCancel }) => {
  const { exit } = useApp();
  const [step, setStep] = useState<WizardStep>('provider');
  const [previousStep, setPreviousStep] = useState<WizardStep>('provider');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Handle Escape to cancel — disabled when ScrollableList or ConfirmDialog is active
  useInput((_input, key) => {
    if (key.escape && step !== 'cancel_confirm' && step !== 'validating' && step !== 'fetching_models') {
      setPreviousStep(step);
      setStep('cancel_confirm');
    }
  }, { isActive: step !== 'provider' && step !== 'models' && step !== 'cancel_confirm' });

  const handleProviderSelect = useCallback((providerId: string) => {
    const id = providerId as ProviderId;
    setSelectedProvider(id);
    const provider = PROVIDERS[id];
    if (provider?.apiKeyRequired) {
      setStep('apikey');
    } else if (provider?.baseUrlConfigurable) {
      setBaseUrl(provider.defaultBaseUrl ?? '');
      setStep('baseurl');
    } else {
      setStep('validating');
    }
  }, []);

  const handleApiKeySubmit = useCallback(() => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }
    setError(null);
    const provider = selectedProvider ? PROVIDERS[selectedProvider] : undefined;
    if (provider?.baseUrlConfigurable) {
      setBaseUrl(provider.defaultBaseUrl ?? '');
      setStep('baseurl');
    } else {
      setStep('validating');
    }
  }, [apiKey, selectedProvider]);

  const handleBaseUrlSubmit = useCallback(() => {
    setStep('validating');
  }, []);

  // Validate provider
  useEffect(() => {
    if (step !== 'validating' || !selectedProvider) return;

    const validate = async () => {
      try {
        const providerInstance = ProviderFactory.create(
          selectedProvider,
          apiKey || undefined,
          baseUrl || undefined,
        );
        const valid = await providerInstance.validate();
        if (valid) {
          setStep('fetching_models');
        } else {
          setError('🔐 Clearance Denied — Could not authenticate with the provider. Check your API key.');
          setStep('apikey');
        }
      } catch (e) {
        getLogger().error('SETUP_VALIDATION', e);
        const spaceErr = resolveSpaceError(e);
        setError(`${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`);
        setStep('apikey');
      }
    };

    void validate();
  }, [step, selectedProvider, apiKey, baseUrl]);

  // Fetch models
  useEffect(() => {
    if (step !== 'fetching_models' || !selectedProvider) return;

    const fetchModels = async () => {
      try {
        const providerInstance = ProviderFactory.create(
          selectedProvider,
          apiKey || undefined,
          baseUrl || undefined,
        );
        const fetchedModels = await providerInstance.listModels();
        if (fetchedModels.length === 0) {
          setError('🏚 Hangar Empty — No models returned by the API. Check your key permissions.');
          setStep('apikey');
          return;
        }
        setModels(fetchedModels);
        setStep('models');
      } catch (e) {
        getLogger().error('SETUP_MODEL_FETCH', e);
        const spaceErr = resolveSpaceError(e);
        setError(`${spaceErr.icon} ${spaceErr.title} — ${spaceErr.message}`);
        setStep('apikey');
      }
    };

    void fetchModels();
  }, [step, selectedProvider, apiKey, baseUrl]);

  const handleModelSelect = useCallback((model: ModelInfo) => {
    if (!selectedProvider) return;

    const config: AgentXConfig = {
      provider: {
        activeProvider: selectedProvider,
        activeModel: model.id,
        providers: {
          [selectedProvider]: {
            apiKey: apiKey || undefined,
            baseUrl: baseUrl || undefined,
            configured: true,
          },
        },
      },
      ui: {
        theme: 'dark',
        showTokenBar: true,
        showTimers: true,
        animationSpeed: 'normal',
      },
      organization: null,
      telemetry: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    const configManager = new ConfigManager();
    configManager.ensureDirectories();
    configManager.save(config);
    onComplete(config);
  }, [selectedProvider, apiKey, baseUrl, onComplete]);

  const handleCancelConfirm = useCallback(() => {
    onCancel();
    exit();
  }, [onCancel, exit]);

  const handleCancelDeny = useCallback(() => {
    setStep(previousStep);
  }, [previousStep]);

  return (
    <Box flexDirection="column" padding={1}>
      <Banner />
      <Box marginTop={1} marginBottom={1}>
        <Text color={COLORS.primary} bold>Setup Wizard</Text>
        <Text color={COLORS.textDim}> — Configure your AI provider</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color={COLORS.error}>⚠ {error}</Text>
        </Box>
      )}

      {step === 'provider' && (
        <ScrollableList
          items={PROVIDER_IDS}
          label="Choose your AI provider"
          onSelect={handleProviderSelect}
          renderItem={(id, isSelected) => {
            const provider = PROVIDERS[id];
            return (
              <Box>
                <Text color={isSelected ? COLORS.text : COLORS.textDim}>
                  {provider?.name ?? id}
                </Text>
                <Text color={COLORS.textDim} dimColor>
                  {' '}({provider?.type})
                </Text>
              </Box>
            );
          }}
        />
      )}

      {step === 'apikey' && (
        <Box flexDirection="column">
          <Text color={COLORS.text}>
            Enter API key for {selectedProvider ? PROVIDERS[selectedProvider]?.name : ''}:
          </Text>
          <Box marginTop={1}>
            <Text color={COLORS.primary}>❯ </Text>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              onSubmit={handleApiKeySubmit}
              mask="*"
              placeholder="sk-..."
            />
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.textDim} dimColor>Enter to submit • Esc to cancel</Text>
          </Box>
        </Box>
      )}

      {step === 'baseurl' && (
        <Box flexDirection="column">
          <Text color={COLORS.text}>Server URL (press Enter for default):</Text>
          <Box marginTop={1}>
            <Text color={COLORS.primary}>❯ </Text>
            <TextInput
              value={baseUrl}
              onChange={setBaseUrl}
              onSubmit={handleBaseUrlSubmit}
              placeholder={selectedProvider ? PROVIDERS[selectedProvider]?.defaultBaseUrl ?? '' : ''}
            />
          </Box>
        </Box>
      )}

      {(step === 'validating' || step === 'fetching_models') && (
        <LoadingIndicator
          label={step === 'validating' ? 'Validating credentials...' : 'Fetching available models...'}
          type="spinner"
        />
      )}

      {step === 'models' && (
        <ScrollableList
          items={models}
          label="Select a model"
          onSelect={handleModelSelect}
          onCancel={() => setStep('provider')}
          renderItem={(model, isSelected) => (
            <Box>
              <Text color={isSelected ? COLORS.text : COLORS.textDim}>
                {model.name}
              </Text>
              <Text color={COLORS.textDim} dimColor>
                {' '}({Math.round(model.contextWindow / 1000)}K ctx)
              </Text>
            </Box>
          )}
        />
      )}

      {step === 'cancel_confirm' && (
        <ConfirmDialog
          message="Cancel setup? Agent-X will exit."
          onConfirm={handleCancelConfirm}
          onCancel={handleCancelDeny}
        />
      )}
    </Box>
  );
};
