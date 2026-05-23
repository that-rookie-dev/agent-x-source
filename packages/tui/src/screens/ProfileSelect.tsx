import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { Banner } from '../components/Banner.js';
import type { Profile } from '@agentx/shared';
import { ProfileManager } from '@agentx/engine';

type ScreenState = 'select' | 'create_name' | 'create_desc' | 'create_prompt' | 'create_confirm';

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

  // Create profile form state
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  useInput((_input, key) => {
    if (screen === 'create_name' && key.escape) {
      setScreen('select');
    } else if (screen === 'create_desc' && key.escape) {
      setScreen('create_name');
    } else if (screen === 'create_prompt' && key.escape) {
      setScreen('create_desc');
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
      description: newDesc.trim() || `Custom profile: ${newName.trim()}`,
      systemPrompt: newPrompt.trim(),
      expertise: [],
      traits: [],
      toolPreferences: [],
      isDefault: false,
      enabledTools: null,
      disabledTools: null,
    });
    pm.switch(profile.id);
    onSelect(profile);
  };

  // Create profile flow
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
              onSubmit={() => { if (newName.trim()) setScreen('create_desc'); }}
            />
          </Box>
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (screen === 'create_desc') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Profile</Text>
          <Text color={COLORS.textDim}>Step 2/3 — Describe the profile</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Description: </Text>
            <TextInput
              value={newDesc}
              onChange={setNewDesc}
              placeholder="What does this profile specialize in?"
              onSubmit={() => setScreen('create_prompt')}
            />
          </Box>
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (screen === 'create_prompt') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Profile</Text>
          <Text color={COLORS.textDim}>Step 3/3 — System prompt (how the agent should behave)</Text>
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

  if (screen === 'create_confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Confirm New Profile</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.text}>Name: <Text color={COLORS.info}>{newName}</Text></Text>
            <Text color={COLORS.text}>Description: <Text color={COLORS.textDim}>{newDesc || '(none)'}</Text></Text>
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
    { id: '__create__', name: '+ Create new profile', description: '', systemPrompt: '', expertise: [], traits: [], toolPreferences: null, enabledTools: null, disabledTools: null, isDefault: false, createdAt: '', updatedAt: '' } as Profile,
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
              setNewDesc('');
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
                <Text color={COLORS.textDim} dimColor>
                  {' '}— {item.description.slice(0, 50)}{item.description.length > 50 ? '...' : ''}
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
