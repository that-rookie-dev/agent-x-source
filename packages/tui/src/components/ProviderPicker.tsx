import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { LoadingIndicator } from './LoadingIndicator.js';
import { PROVIDERS } from '@agentx/shared';
import type { ProviderConfig, ProviderId, ModelInfo } from '@agentx/shared';
import { ProviderFactory } from '@agentx/engine';

type Step = 'pick' | 'api_key' | 'base_url' | 'validating' | 'models';

interface ProviderPickerProps {
  currentProvider: string;
  onComplete: (providerId: ProviderId, modelId: string, apiKey?: string, baseUrl?: string) => void;
  onDismiss: () => void;
}

const providerList = Object.values(PROVIDERS) as ProviderConfig[];

export const ProviderPicker: React.FC<ProviderPickerProps> = ({
  currentProvider,
  onComplete,
  onDismiss,
}) => {
  const [step, setStep] = useState<Step>('pick');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Validation + model fetch effect
  useEffect(() => {
    if (step !== 'validating' || !selectedProvider) return;
    let cancelled = false;

    void (async () => {
      try {
        const provider = ProviderFactory.create(
          selectedProvider.id,
          apiKey.trim() || undefined,
          baseUrl.trim() || undefined,
        );
        const valid = await provider.validate();
        if (cancelled) return;
        if (!valid) {
          setError('Connection failed — check credentials or ensure the server is running.');
          setStep(selectedProvider.apiKeyRequired ? 'api_key' : 'base_url');
          return;
        }
        const fetched = await provider.listModels();
        if (cancelled) return;
        if (fetched.length === 0) {
          setError('No models found. Check permissions or load a model.');
          setStep(selectedProvider.apiKeyRequired ? 'api_key' : 'base_url');
          return;
        }
        setModels(fetched);
        setModelIndex(0);
        setStep('models');
      } catch {
        if (cancelled) return;
        setError('Connection failed — check your network or server.');
        setStep(selectedProvider.apiKeyRequired ? 'api_key' : 'base_url');
      }
    })();

    return () => { cancelled = true; };
  }, [step, selectedProvider, apiKey, baseUrl]);

  useInput((_input, key) => {
    if (step === 'validating') return; // no input during validation

    if (key.escape) {
      if (step === 'models') {
        setStep(selectedProvider?.baseUrlConfigurable ? 'base_url' : selectedProvider?.apiKeyRequired ? 'api_key' : 'pick');
      } else if (step === 'api_key' || step === 'base_url') {
        setStep('pick');
        setError(null);
      } else {
        onDismiss();
      }
      return;
    }

    if (step === 'pick') {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => Math.min(providerList.length - 1, i + 1));
      } else if (key.return) {
        const provider = providerList[selectedIndex]!;
        setSelectedProvider(provider);
        setError(null);

        if (provider.apiKeyRequired) {
          setStep('api_key');
        } else if (provider.baseUrlConfigurable) {
          setBaseUrl(provider.defaultBaseUrl ?? '');
          setStep('base_url');
        } else {
          setStep('validating');
        }
      }
    } else if (step === 'api_key') {
      if (key.return && apiKey.trim()) {
        setError(null);
        if (selectedProvider?.baseUrlConfigurable) {
          setBaseUrl(selectedProvider.defaultBaseUrl ?? '');
          setStep('base_url');
        } else {
          setStep('validating');
        }
      }
    } else if (step === 'base_url') {
      if (key.return) {
        setError(null);
        setStep('validating');
      }
    } else if (step === 'models') {
      if (key.upArrow) {
        setModelIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setModelIndex((i) => Math.min(models.length - 1, i + 1));
      } else if (key.return) {
        const model = models[modelIndex];
        if (model) {
          onComplete(
            selectedProvider!.id,
            model.id,
            apiKey.trim() || undefined,
            baseUrl.trim() || selectedProvider?.defaultBaseUrl,
          );
        }
      }
    }
  });

  if (step === 'pick') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
        <Text color={COLORS.primary} bold>Select Provider</Text>
        <Text color={COLORS.textDim} dimColor>↑↓ navigate • Enter select • Esc cancel</Text>
        <Box flexDirection="column" marginTop={1}>
          {providerList.map((p, i) => (
            <Box key={p.id}>
              <Text color={i === selectedIndex ? COLORS.primary : COLORS.text}>
                {i === selectedIndex ? '▸ ' : '  '}
                {p.name}
                {p.id === currentProvider ? ' (current)' : ''}
              </Text>
              <Text color={COLORS.textDim} dimColor>
                {' '}{p.type === 'local' ? '🖥 local' : '☁ cloud'}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  if (step === 'api_key') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
        <Text color={COLORS.primary} bold>Setup {selectedProvider!.name}</Text>
        {error && (
          <Box marginTop={1}>
            <Text color={COLORS.error}>⚠ {error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={COLORS.text}>API Key: </Text>
          <TextInput value={apiKey} onChange={(v) => { setApiKey(v); setError(null); }} placeholder="sk-..." mask="*" />
        </Box>
        <Text color={COLORS.textDim} dimColor>Enter to confirm • Esc back</Text>
      </Box>
    );
  }

  if (step === 'base_url') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
        <Text color={COLORS.primary} bold>Setup {selectedProvider!.name}</Text>
        {error && (
          <Box marginTop={1}>
            <Text color={COLORS.error}>⚠ {error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={COLORS.text}>Base URL: </Text>
          <TextInput
            value={baseUrl}
            onChange={(v) => { setBaseUrl(v); setError(null); }}
            placeholder={selectedProvider?.defaultBaseUrl ?? 'http://localhost:...'}
          />
        </Box>
        <Text color={COLORS.textDim} dimColor>Enter to confirm (empty = default) • Esc back</Text>
      </Box>
    );
  }

  if (step === 'validating') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
        <Text color={COLORS.primary} bold>{selectedProvider!.name}</Text>
        <Box marginTop={1}>
          <LoadingIndicator label="Connecting & fetching models..." />
        </Box>
      </Box>
    );
  }

  if (step === 'models') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
        <Text color={COLORS.primary} bold>Select Model — {selectedProvider!.name}</Text>
        <Text color={COLORS.textDim} dimColor>↑↓ navigate • Enter select • Esc back</Text>
        <Box flexDirection="column" marginTop={1}>
          {models.map((m, i) => (
            <Box key={m.id}>
              <Text color={i === modelIndex ? COLORS.primary : COLORS.text}>
                {i === modelIndex ? '▸ ' : '  '}
                {m.id}
              </Text>
              {m.contextWindow > 0 && (
                <Text color={COLORS.textDim} dimColor>
                  {' '}{Math.round(m.contextWindow / 1024)}K ctx
                </Text>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  return null;
};
