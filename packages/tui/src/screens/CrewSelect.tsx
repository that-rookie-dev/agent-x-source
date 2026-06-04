import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { Banner } from '../components/Banner.js';
import type { Crew, CrewEmotion } from '@agentx/shared';
import { CrewManager } from '@agentx/engine';

type ScreenState = 'select' | 'create_name' | 'create_callsign' | 'create_prompt' | 'create_tone' | 'create_confirm' | 'edit_pick' | 'edit_name' | 'edit_callsign' | 'edit_prompt' | 'edit_tone' | 'edit_confirm';

const TONE_OPTIONS: Array<{ id: CrewEmotion; label: string; description: string }> = [
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

interface CrewSelectProps {
  onSelect: (crew: Crew) => void;
  currentProvider?: string;
  currentModel?: string;
  dek?: Buffer | null;
}

export const CrewSelect: React.FC<CrewSelectProps> = ({
  onSelect,
  currentProvider,
  currentModel,
  dek,
}) => {
  const [pm] = useState(() => new CrewManager());

  // Apply DEK whenever it changes
  if (dek) pm.setDEK(dek);

  // Derive current state on every render
  const userCrews = pm.list().filter((p) => !p.isDefault);

  // Track whether DEK has been applied at least once
  const [dekApplied, setDekApplied] = useState(!!dek);
  useEffect(() => {
    if (dek && !dekApplied) setDekApplied(true);
  }, [dek, dekApplied]);

  // Initialize screen to 'select' by default - only determine actual state after DEK is applied
  const [screen, setScreen] = useState<ScreenState>('select');

  // Keep screen in sync when userCrews changes after DEK arrives
  useEffect(() => {
    // Only make screen decisions after DEK has been applied
    if (!dekApplied) return;
    const desired = userCrews.length === 0 ? ('create_name' as const) : ('select' as const);
    if (screen !== desired) setScreen(desired);
  }, [userCrews.length, screen, dekApplied]);

  // Create crew form state
  const [newName, setNewName] = useState('');
  const [newCallsign, setNewCallsign] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newTone, setNewTone] = useState<CrewEmotion>('friendly');
  const [newError, setNewError] = useState('');

  // Edit crew state
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null);
  const [editName, setEditName] = useState('');
  const [editCallsign, setEditCallsign] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editTone, setEditTone] = useState<CrewEmotion>('friendly');
  const [editError, setEditError] = useState('');

  useInput((_input, key) => {
    if (screen === 'create_name' && key.escape) {
      setScreen('select');
    } else if (screen === 'create_callsign' && key.escape) {
      setScreen('create_name');
    } else if (screen === 'create_prompt' && key.escape) {
      setScreen('create_callsign');
    } else if (screen === 'create_tone' && key.escape) {
      setScreen('create_prompt');
    } else if (screen === 'create_confirm' && key.escape) {
      setScreen('create_tone');
    } else if (screen === 'edit_name' && key.escape) {
      setScreen('edit_pick');
    } else if (screen === 'edit_callsign' && key.escape) {
      setScreen('edit_name');
    } else if (screen === 'edit_prompt' && key.escape) {
      setScreen('edit_callsign');
    } else if (screen === 'edit_tone' && key.escape) {
      setScreen('edit_prompt');
    } else if (screen === 'edit_confirm' && key.escape) {
      setScreen('edit_tone');
    }
  });

  const handleSelect = (crew: Crew) => {
    pm.switch(crew.id);
    onSelect(crew);
  };

  const handleCreateSubmit = () => {
    setNewError('');
    const id = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
      const crew = pm.create({
        id,
        name: newName.trim(),
        callsign: newCallsign.trim() || id,
        systemPrompt: newPrompt.trim(),
        emotion: newTone,
        isDefault: false,
      });
      pm.switch(crew.id);
      onSelect(crew);
    } catch (e: unknown) {
      setNewError(e instanceof Error ? e.message : 'Creation failed');
    }
  };

  const handleEditStart = (crew: Crew) => {
    setEditingCrew(crew);
    setEditName(crew.name);
    setEditCallsign(crew.callsign);
    setEditPrompt(crew.systemPrompt);
    setEditTone(crew.emotion ?? 'friendly');
    setScreen('edit_name');
  };

  const handleEditSubmit = () => {
    if (!editingCrew) return;
    setEditError('');
    try {
      const updated = pm.update(editingCrew.id, {
        name: editName.trim(),
        callsign: editCallsign.trim() || editingCrew.id,
        systemPrompt: editPrompt.trim(),
        emotion: editTone,
      });
      if (updated) {
        pm.switch(updated.id);
        onSelect(updated);
      }
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Update failed');
    }
  };

  // Create crew flow — Step 1: Name
  if (screen === 'create_name') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Crew Member</Text>
          <Text color={COLORS.textDim}>Step 1/4 — Give your crew a name</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Name: </Text>
            <TextInput
              value={newName}
              onChange={setNewName}
              placeholder="e.g. DevOps Engineer"
              onSubmit={() => { if (newName.trim()) setScreen('create_callsign'); }}
            />
          </Box>
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Create crew flow — Step 2: Callsign
  if (screen === 'create_callsign') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Crew Member</Text>
          <Text color={COLORS.textDim}>Step 2/4 — Choose a unique callsign (no spaces, used for @mentions)</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Callsign: </Text>
            <TextInput
              value={newCallsign}
              onChange={setNewCallsign}
              placeholder="e.g. devops-eng"
              onSubmit={() => { if (newCallsign.trim()) setScreen('create_prompt'); }}
            />
          </Box>
          {newError ? <Text color={COLORS.error}>{newError}</Text> : null}
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Create crew flow — Step 3: System Prompt
  if (screen === 'create_prompt') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Crew Member</Text>
          <Text color={COLORS.textDim}>Step 3/4 — Describe who this agent is (what it knows, what it helps with)</Text>
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

  // Create crew flow — Step 3: Tone / Emotion
  if (screen === 'create_tone') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Create New Crew Member</Text>
          <Text color={COLORS.textDim}>Step 4/4 — Pick a personality tone for your agent</Text>
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

  // Create crew flow — Confirm
  if (screen === 'create_confirm') {
    const toneLabel = TONE_OPTIONS.find((t) => t.id === newTone)?.label ?? newTone;
    const fallbackCallsign = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Confirm New Crew Member</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.text}>Name: <Text color={COLORS.info}>{newName}</Text></Text>
            <Text color={COLORS.text}>Callsign: <Text color={COLORS.accent}>@{newCallsign || fallbackCallsign}</Text></Text>
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

  // Edit crew flow — Pick which crew to edit
  if (screen === 'edit_pick') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Edit Crew Member</Text>
          <Text color={COLORS.textDim}>Select a crew to edit</Text>
        </Box>
        <Box marginTop={1}>
          <ScrollableList
            items={userCrews}
            label="Crew"
            onSelect={(item) => handleEditStart(item)}
            onCancel={() => setScreen('select')}
            renderItem={(item: Crew, isSelected: boolean) => (
              <Box>
                <Text color={isSelected ? COLORS.primary : COLORS.text} bold={isSelected}>
                  {item.name}
                </Text>
                {item.emotion && <Text color={COLORS.textDim}> ({item.emotion})</Text>}
              </Box>
            )}
          />
        </Box>
      </Box>
    );
  }

  // Edit crew flow — Step 1: Name
  if (screen === 'edit_name') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Edit Crew Member</Text>
          <Text color={COLORS.textDim}>Step 1/4 — Update the crew name</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Name: </Text>
            <TextInput
              value={editName}
              onChange={setEditName}
              placeholder="e.g. DevOps Engineer"
              onSubmit={() => { if (editName.trim()) setScreen('edit_callsign'); }}
            />
          </Box>
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Edit crew flow — Step 2: Callsign
  if (screen === 'edit_callsign') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Edit Crew Member</Text>
          <Text color={COLORS.textDim}>Step 2/4 — Update the callsign (used for @mentions)</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Callsign: </Text>
            <TextInput
              value={editCallsign}
              onChange={setEditCallsign}
              placeholder={editingCrew?.id ?? ''}
              onSubmit={() => { if (editCallsign.trim()) setScreen('edit_prompt'); }}
            />
          </Box>
          {editError ? <Text color={COLORS.error}>{editError}</Text> : null}
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Edit crew flow — Step 3: Prompt
  if (screen === 'edit_prompt') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Edit Crew Member</Text>
          <Text color={COLORS.textDim}>Step 3/4 — Update the agent description</Text>
          <Box marginTop={1}>
            <Text color={COLORS.text}>Prompt: </Text>
            <TextInput
              value={editPrompt}
              onChange={setEditPrompt}
              placeholder="You are a..."
              onSubmit={() => { if (editPrompt.trim()) setScreen('edit_tone'); }}
            />
          </Box>
          <Text color={COLORS.textDim} dimColor>Enter to continue • Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // Edit crew flow — Step 3: Tone
  if (screen === 'edit_tone') {
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Edit Crew Member</Text>
          <Text color={COLORS.textDim}>Step 4/4 — Pick a personality tone</Text>
        </Box>
        <Box marginTop={1}>
          <ScrollableList
            items={TONE_OPTIONS}
            label="Tones"
            onSelect={(item) => {
              setEditTone(item.id);
              setScreen('edit_confirm');
            }}
            renderItem={(item, isSelected: boolean) => (
              <Box>
                <Text color={isSelected ? COLORS.primary : COLORS.text} bold={isSelected}>
                  {item.label}{item.id === editTone ? ' ●' : ''}
                </Text>
                <Text color={COLORS.textDim}> — {item.description}</Text>
              </Box>
            )}
          />
        </Box>
      </Box>
    );
  }

  // Edit crew flow — Confirm
  if (screen === 'edit_confirm') {
    const toneLabel = TONE_OPTIONS.find((t) => t.id === editTone)?.label ?? editTone;
    return (
      <Box flexDirection="column" padding={1}>
        <Banner provider={currentProvider} model={currentModel} />
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text color={COLORS.primary} bold>Confirm Changes</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.text}>Name: <Text color={COLORS.info}>{editName}</Text></Text>
            <Text color={COLORS.text}>Callsign: <Text color={COLORS.accent}>@{editCallsign}</Text></Text>
            <Text color={COLORS.text}>Prompt: <Text color={COLORS.textDim}>{editPrompt.slice(0, 80)}{editPrompt.length > 80 ? '...' : ''}</Text></Text>
            <Text color={COLORS.text}>Tone: <Text color={COLORS.info}>{toneLabel}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text color={COLORS.success}>Press Enter to save • Esc to go back</Text>
          </Box>
          <CreateConfirmInput onConfirm={handleEditSubmit} onCancel={() => setScreen('edit_tone')} />
        </Box>
      </Box>
    );
  }

  // Main crew selection screen
  const items = [
    ...userCrews,
    { id: '__edit__', name: '~ Edit a crew member', systemPrompt: '', isDefault: false, createdAt: '', updatedAt: '' } as Crew,
    { id: '__create__', name: '+ Create new crew member', systemPrompt: '', isDefault: false, createdAt: '', updatedAt: '' } as Crew,
  ];

  return (
    <Box flexDirection="column" padding={1}>
      <Banner provider={currentProvider} model={currentModel} />
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text color={COLORS.primary} bold>Select Crew Member</Text>
        <Text color={COLORS.textDim}>Choose a crew to define how Agent-X behaves this session</Text>
      </Box>
      <Box marginTop={1}>
        <ScrollableList
          items={items}
          label="Crew"
          onSelect={(item) => {
            if (item.id === '__create__') {
              setScreen('create_name');
              setNewName('');
              setNewPrompt('');
              setNewTone('friendly');
            } else if (item.id === '__edit__') {
              setScreen('edit_pick');
            } else {
              handleSelect(item);
            }
          }}
          renderItem={(item: Crew, isSelected: boolean) => {
            if (item.id === '__create__') {
              return (
                <Box>
                  <Text color={isSelected ? COLORS.success : COLORS.textDim} bold={isSelected}>
                    + Create new crew member
                  </Text>
                </Box>
              );
            }
            if (item.id === '__edit__') {
              return (
                <Box>
                  <Text color={isSelected ? COLORS.accent : COLORS.textDim} bold={isSelected}>
                    ~ Edit a crew member
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
