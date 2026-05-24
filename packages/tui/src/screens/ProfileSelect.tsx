import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { Banner } from '../components/Banner.js';
import type { Profile } from '@agentx/shared';
import { ProfileManager } from '@agentx/engine';

type ScreenState = 'select' | 'create_name' | 'create_prompt' | 'create_confirm';

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
  const [profiles] = useState<Profile[]>(() => pm.list());
  const [screen, setScreen] = useState<ScreenState>('select');

  // Create profile form state (name + prompt only)
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  useInput((_input, key) => {
    if (screen === 'create_name' && key.escape) {
      setScreen('select');
    } else if (screen === 'create_prompt' && key.escape) {
      setScreen('create_name');
    } else if (screen === 'create_confirm' && key.escape) {
      setScreen('create_prompt');
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
          <Text color={COLORS.textDim}>Step 1/2 — Give your profile a name</Text>
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
          <Text color={COLORS.textDim}>Step 2/2 — System prompt (how the agent should behave)</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Prompt: </Text>
            <TextInput
              value={newPrompt}
              onChange={setNewPrompt}
              placeholder="You are a..."
              onSubmit={() => { if (newPrompt.trim()) setScreen('create_confirm'); }}
            />
          </Box>
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Create profile flow — Confirm
  if (screen === 'create_confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Confirm New Profile</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.text}>Name: <Text color={COLORS.info}>{newName}</Text></Text>
            <Text color={COLORS.text}>Prompt: <Text color={COLORS.textDim}>{newPrompt.slice(0, 80)}{newPrompt.length > 80 ? '...' : ''}</Text></Text>
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
