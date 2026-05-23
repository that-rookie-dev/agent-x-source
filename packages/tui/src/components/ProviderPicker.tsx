import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { PROVIDERS } from '@agentx/shared';
import type { ProviderConfig, ProviderId } from '@agentx/shared';

type Step = 'pick' | 'api_key' | 'base_url' | 'confirm';

interface ProviderPickerProps {
  currentProvider: string;
  onSelect: (providerId: ProviderId, apiKey?: string, baseUrl?: string) => void;
  onDismiss: () => void;
}

const providerList = Object.values(PROVIDERS) as ProviderConfig[];

export const ProviderPicker: React.FC<ProviderPickerProps> = ({
  currentProvider,
  onSelect,
  onDismiss,
}) => {
  const [step, setStep] = useState<Step>('pick');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  useInput((_input, key) => {
    if (key.escape) {
      onDismiss();
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

        if (provider.apiKeyRequired) {
          setStep('api_key');
        } else if (provider.baseUrlConfigurable) {
          setBaseUrl(provider.defaultBaseUrl ?? '');
          setStep('base_url');
        } else {
          onSelect(provider.id, undefined, undefined);
        }
      }
    } else if (step === 'api_key') {
      if (key.return && apiKey.trim()) {
        if (selectedProvider?.baseUrlConfigurable) {
          setBaseUrl(selectedProvider.defaultBaseUrl ?? '');
          setStep('base_url');
        } else {
          onSelect(selectedProvider!.id, apiKey.trim(), undefined);
        }
      }
    } else if (step === 'base_url') {
      if (key.return) {
        const url = baseUrl.trim() || selectedProvider?.defaultBaseUrl;
        onSelect(selectedProvider!.id, apiKey.trim() || undefined, url);
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
        <Box marginTop={1}>
          <Text color={COLORS.text}>API Key: </Text>
          <TextInput value={apiKey} onChange={setApiKey} placeholder="sk-..." mask="*" />
        </Box>
        <Text color={COLORS.textDim} dimColor>Enter to confirm • Esc to cancel</Text>
      </Box>
    );
  }

  if (step === 'base_url') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
        <Text color={COLORS.primary} bold>Setup {selectedProvider!.name}</Text>
        <Box marginTop={1}>
          <Text color={COLORS.text}>Base URL: </Text>
          <TextInput
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder={selectedProvider?.defaultBaseUrl ?? 'http://localhost:...'}
          />
        </Box>
        <Text color={COLORS.textDim} dimColor>Enter to confirm (empty = default) • Esc to cancel</Text>
      </Box>
    );
  }

  return null;
};
