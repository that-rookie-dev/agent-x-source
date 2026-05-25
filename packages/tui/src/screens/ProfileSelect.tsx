import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { Banner } from '../components/Banner.js';
import type { Profile, ProfileEmotion } from '@agentx/shared';
import { ProfileManager } from '@agentx/engine';

type ScreenState = 'select' | 'create_name' | 'create_prompt' | 'create_tone' | 'create_confirm';

const TONE_OPTIONS: Array<{ id: ProfileEmotion; label: string; description: string }> = [
  { id: 'professional', label: '💼 Professional', description: 'Precise, formal, business-like' },
  { id: 'friendly', label: '😊 Friendly', description: 'Warm, approachable, casual' },
  { id: 'witty', label: '🧠 Witty', description: 'Clever, sharp, dry humor' },
  { id: 'funny', label: '😂 Funny', description: 'Humorous, entertaining, jokes' },
  { id: 'kind', label: '💛 Kind', description: 'Gentle, empathetic, supportive' },
  { id: 'sarcastic', label: '😏 Sarcastic', description: 'Dry, ironic, deadpan' },
  { id: 'flirty', label: '😘 Flirty', description: 'Playful, charming, teasing' },
  { id: 'arrogant', label: '👑 Arrogant', description: 'Supremely confident, show-off' },
  { id: 'happy', label: '🌟 Happy', description: 'Enthusiastic, upbeat, energetic' },
  { id: 'sad', label: '🌧 Melancholic', description: 'Thoughtful, reflective, poetic' },
];

interface ProfileSelectProps {
  onSelect: (profile: Profile) => void;
  currentProvider?: string;
  currentModel?: string;
}

export const ProfileSelect: React.FC<ProfileSelectProps> = ({
  onSelect,
  currentProvider,
  currentModel,
}) => {
  const [pm] = useState(() => new ProfileManager());
  const [profiles] = useState<Profile[]>(() => pm.list().filter((p) => !p.isDefault));
  const [screen, setScreen] = useState<ScreenState>(() => {
    // If no user-created profiles, go straight to create flow
    const userProfiles = pm.list().filter((p) => !p.isDefault);
    return userProfiles.length === 0 ? 'create_name' : 'select';
  });

  // Create profile form state
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newTone, setNewTone] = useState<ProfileEmotion>('friendly');

  useInput((_input, key) => {
    if (screen === 'create_name' && key.escape) {
      setScreen('select');
    } else if (screen === 'create_prompt' && key.escape) {
      setScreen('create_name');
    } else if (screen === 'create_tone' && key.escape) {
      setScreen('create_prompt');
    } else if (screen === 'create_confirm' && key.escape) {
      setScreen('create_tone');
    }
  });

  const handleSelect = (profile: Profile) => {
    pm.switch(profile.id);
    onSelect(profile);
  };

  const handleCreateSubmit = () => {
    const id = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const profile = pm.create({
      id,
      name: newName.trim(),
      systemPrompt: newPrompt.trim(),
      emotion: newTone,
      isDefault: false,
    });
    pm.switch(profile.id);
    onSelect(profile);
  };

  // Create profile flow — Step 1: Name
  if (screen === 'create_name') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Profile</Text>
          <Text color={COLORS.textDim}>Step 1/3 — Give your profile a name</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Name: </Text>
            <TextInput
              value={newName}
              onChange={setNewName}
              placeholder="e.g. DevOps Engineer"
              onSubmit={() => { if (newName.trim()) setScreen('create_prompt'); }}
            />
          </Box>
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Create profile flow — Step 2: System Prompt
  if (screen === 'create_prompt') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Profile</Text>
          <Text color={COLORS.textDim}>Step 2/3 — Describe who this agent is (what it knows, what it helps with)</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Prompt: </Text>
            <TextInput
              value={newPrompt}
              onChange={setNewPrompt}
              placeholder="You are a..."
              onSubmit={() => { if (newPrompt.trim()) setScreen('create_tone'); }}
            />
          </Box>
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Create profile flow — Step 3: Tone / Emotion
  if (screen === 'create_tone') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Profile</Text>
          <Text color={COLORS.textDim}>Step 3/3 — Pick a personality tone for your agent</Text>
        </Box>
        <Box marginTop={1}>
          <ScrollableList
            items={TONE_OPTIONS}
            label="Tones"
            onSelect={(item) => {
              setNewTone(item.id);
              setScreen('create_confirm');
            }}
            renderItem={(item, isSelected: boolean) => (
              <Box>
                <Text color={isSelected ? COLORS.primary : COLORS.text} bold={isSelected}>
                  {item.label}
                </Text>
                <Text color={COLORS.textDim}> — {item.description}</Text>
              </Box>
            )}
          />
        </Box>
      </Box>
    );
  }

  // Create profile flow — Confirm
  if (screen === 'create_confirm') {
    const toneLabel = TONE_OPTIONS.find((t) => t.id === newTone)?.label ?? newTone;
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Confirm New Profile</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.text}>Name: <Text color={COLORS.info}>{newName}</Text></Text>
            <Text color={COLORS.text}>Prompt: <Text color={COLORS.textDim}>{newPrompt.slice(0, 80)}{newPrompt.length > 80 ? '...' : ''}</Text></Text>
            <Text color={COLORS.text}>Tone: <Text color={COLORS.info}>{toneLabel}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.success}>Press Enter to create and activate • Esc to go back</Text>
          </Box>
          <CreateConfirmInput onConfirm={handleCreateSubmit} onCancel={() => setScreen('create_prompt')} />
        </Box>
      </Box>
    );
  }

  // Main profile selection screen
  const items = [
    ...profiles,
    { id: '__create__', name: '+ Create new profile', systemPrompt: '', isDefault: false, createdAt: '', updatedAt: '' } as Profile,
  ];

  return (
    <Box flexDirection="column" padding={1}>
      <Banner provider={currentProvider} model={currentModel} />
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text color={COLORS.primary} bold>Select Profile</Text>
        <Text color={COLORS.textDim}>Choose a profile to define how Agent-X behaves this session</Text>
      </Box>
      <Box marginTop={1}>
        <ScrollableList
          items={items}
          label="Profiles"
          onSelect={(item) => {
            if (item.id === '__create__') {
              setScreen('create_name');
              setNewName('');
              setNewPrompt('');
              setNewTone('friendly');
            } else {
              handleSelect(item);
            }
          }}
          renderItem={(item: Profile, isSelected: boolean) => {
            if (item.id === '__create__') {
              return (
                <Box>
                  <Text color={isSelected ? COLORS.success : COLORS.textDim} bold={isSelected}>
                    + Create new profile
                  </Text>
                </Box>
              );
            }
            return (
              <Box>
                <Text color={isSelected ? COLORS.primary : COLORS.text}>
                  {item.name}
                </Text>
              </Box>
            );
          }}
        />
      </Box>
    </Box>
  );
};

// Small helper to handle Enter/Esc in confirm screen
const CreateConfirmInput: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
  useInput((_input, key) => {
    if (key.return) onConfirm();
    if (key.escape) onCancel();
  });
  return null;
};
