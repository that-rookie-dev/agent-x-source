import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { LoadingIndicator } from './LoadingIndicator.js';
import { PROVIDERS } from '@agentx/shared';
import type { ProviderConfig, ProviderId, ModelInfo, ProviderProfile } from '@agentx/shared';
import { ProviderFactory, ConfigManager } from '@agentx/engine';

type Step = 'pick' | 'profiles' | 'api_key' | 'base_url' | 'add_profile' | 'confirm_delete' | 'validating' | 'models';

interface ProviderPickerProps {
  currentProvider: string;
  onComplete: (providerId: ProviderId, modelId: string, contextWindow: number, apiKey?: string, baseUrl?: string) => void;
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
  const [profiles, setProfiles] = useState<Array<{ id: string; profile: ProviderProfile }>>([]);
  const [selectedProfileIndex, setSelectedProfileIndex] = useState(0);
  const [newProfileLabel, setNewProfileLabel] = useState('');
  const [newProfileKey, setNewProfileKey] = useState('');
  const [newProfileUrl, setNewProfileUrl] = useState('');

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
    if (step === 'validating') return;

    if (step === 'pick') {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(providerList.length - 1, i + 1));
        return;
      }
      if (key.escape) {
        onDismiss();
        return;
      }
      if (key.return) {
        const provider = providerList[selectedIndex]!;
        setSelectedProvider(provider);
        setError(null);
        try {
          const cm = new ConfigManager();
          const pv = cm.getProviderProfiles(provider.id);
          if (pv.profiles && Object.keys(pv.profiles).length > 0) {
            setProfiles(Object.keys(pv.profiles).map((id) => ({ id, profile: pv.profiles![id]! })));
            setSelectedProfileIndex(0);
            setStep('profiles');
            return;
          }
        } catch { /* ignore */ }
        if (provider.apiKeyRequired) {
          setStep('api_key');
        } else if (provider.baseUrlConfigurable) {
          setBaseUrl(provider.defaultBaseUrl ?? '');
          setStep('base_url');
        } else {
          setStep('validating');
        }
        return;
      }
    } else if (step === 'profiles') {
      if (key.upArrow) {
        setSelectedProfileIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedProfileIndex((i) => Math.min(profiles.length, i + 1));
        return;
      }
      if (key.escape) {
        setStep('pick');
        setError(null);
        return;
      }
      if (key.return) {
        if (!selectedProvider) return;
        if (selectedProfileIndex >= profiles.length) {
          setNewProfileLabel('');
          setNewProfileKey('');
          setNewProfileUrl('');
          setStep('add_profile');
        } else {
          const sel = profiles[selectedProfileIndex];
          if (!sel) return;
          const cm = new ConfigManager();
          cm.setActiveProviderProfile(selectedProvider.id, sel.id);
          setApiKey(sel.profile.apiKey ?? '');
          setBaseUrl(sel.profile.baseUrl ?? '');
          setStep('validating');
        }
        return;
      }
      if (_input === 'd') {
        if (selectedProfileIndex < profiles.length) {
          setStep('confirm_delete');
        }
        return;
      }
    } else if (step === 'add_profile') {
      if (key.escape) {
        setStep('profiles');
        setError(null);
        return;
      }
      if (key.return) {
        if (!selectedProvider) return;
        const isLocal = selectedProvider.baseUrlConfigurable;
        if (!newProfileLabel.trim()) {
          setError('Label required');
          return;
        }
        if (!isLocal && !newProfileKey.trim()) {
          setError('API key required');
          return;
        }
        if (isLocal && !newProfileUrl.trim()) {
          setError('Base URL required');
          return;
        }
        const id = newProfileLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `p-${Date.now()}`;
        const profile: ProviderProfile = {
          label: newProfileLabel.trim(),
          apiKey: newProfileKey.trim() || undefined,
          baseUrl: newProfileUrl.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
        try {
          const cm = new ConfigManager();
          cm.addProviderProfile(selectedProvider.id, id, profile, true);
          const pv = cm.getProviderProfiles(selectedProvider.id);
          setProfiles(Object.keys(pv.profiles ?? {}).map((pid) => ({ id: pid, profile: pv.profiles![pid]! })));
          setApiKey(profile.apiKey ?? '');
          setBaseUrl(profile.baseUrl ?? '');
          setStep('validating');
        } catch {
          setError('Failed to save profile');
        }
        return;
      }
    } else if (step === 'confirm_delete') {
      if (!selectedProvider) return;
      if (_input === 'y' || _input === 'Y') {
        try {
          const cm = new ConfigManager();
          const sel = profiles[selectedProfileIndex];
          if (sel) cm.removeProviderProfile(selectedProvider.id, sel.id);
          const pv = cm.getProviderProfiles(selectedProvider.id);
          setProfiles(Object.keys(pv.profiles ?? {}).map((id) => ({ id, profile: pv.profiles![id]! })));
          setSelectedProfileIndex(0);
        } catch {}
        setStep('profiles');
        return;
      } else {
        setStep('profiles');
        return;
      }
    } else if (step === 'api_key') {
      if (key.escape) { setStep('pick'); setError(null); return; }
      if (key.return && apiKey.trim()) {
        setError(null);
        if (selectedProvider?.baseUrlConfigurable) {
          setBaseUrl(selectedProvider.defaultBaseUrl ?? '');
          setStep('base_url');
        } else {
          setStep('validating');
        }
        return;
      }
    } else if (step === 'base_url') {
      if (key.escape) { setStep('pick'); setError(null); return; }
      if (key.return) { setError(null); setStep('validating'); return; }
    } else if (step === 'models') {
      if (key.upArrow) { setModelIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelIndex((i) => Math.min(models.length - 1, i + 1)); return; }
      if (key.return) {
        const model = models[modelIndex];
        if (model) {
          onComplete(
            selectedProvider!.id,
            model.id,
            model.contextWindow,
            apiKey.trim() || undefined,
            baseUrl.trim() || selectedProvider?.defaultBaseUrl,
          );
        }
        return;
      }
      if (key.escape) { setStep('pick'); setError(null); return; }
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

    if (step === 'profiles') {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
          <Text color={COLORS.primary} bold>Clearance Vault — {selectedProvider!.name}</Text>
          <Text color={COLORS.textDim} dimColor>↑↓ navigate • Enter select • Esc back • d delete</Text>
          <Box flexDirection="column" marginTop={1}>
            {profiles.map((p, i) => (
              <Box key={p.id}>
                <Text color={i === selectedProfileIndex ? COLORS.primary : COLORS.text}>
                  {i === selectedProfileIndex ? '▸ ' : '  '}{p.profile.label}
                </Text>
                <Text color={COLORS.textDim} dimColor>
                  {' '}{p.profile.apiKey ? '☁ key' : ''}{p.profile.baseUrl ? '🖥 url' : ''}
                </Text>
              </Box>
            ))}
            <Box>
              <Text color={selectedProfileIndex === profiles.length ? COLORS.primary : COLORS.text}>
                {selectedProfileIndex === profiles.length ? '▸ ' : '  '}+ Add new profile
              </Text>
            </Box>
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

  if (step === 'add_profile') {
    const isLocal = selectedProvider?.baseUrlConfigurable ?? false;
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
        <Text color={COLORS.primary} bold>Add Profile — {selectedProvider!.name}</Text>
        <Box marginTop={1}>
          <Text color={COLORS.text}>Label: </Text>
          <TextInput value={newProfileLabel} onChange={(v) => setNewProfileLabel(v)} placeholder="e.g. Personal, Work" />
        </Box>
        {!isLocal && (
          <Box marginTop={1}>
            <Text color={COLORS.text}>API Key: </Text>
            <TextInput value={newProfileKey} onChange={(v) => setNewProfileKey(v)} placeholder="sk-..." mask="*" />
          </Box>
        )}
        {isLocal && (
          <Box marginTop={1}>
            <Text color={COLORS.text}>Base URL: </Text>
            <TextInput value={newProfileUrl} onChange={(v) => setNewProfileUrl(v)} placeholder={selectedProvider?.defaultBaseUrl ?? 'http://localhost:...'} />
          </Box>
        )}
        <Text color={COLORS.textDim} dimColor>Enter to save • Esc back</Text>
      </Box>
    );
  }

  if (step === 'confirm_delete') {
    const sel = profiles[selectedProfileIndex];
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1} marginX={1}>
        <Text color={COLORS.primary} bold>Delete Profile</Text>
        <Box marginTop={1}>
          <Text color={COLORS.text}>Delete "{sel?.profile.label}"? (y/N)</Text>
        </Box>
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
