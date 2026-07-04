import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import type { AgentPersonaConfig, CommunicationStyle, DecisionMakingStyle } from '../../api';
import {
  settingsTheme,
  settingsHelperSx,
  settingsMonoSx,
  settingsTextFieldSx,
  settingsScanlineSx,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';

const COMM_STYLES: { value: CommunicationStyle; label: string; desc: string }[] = [
  { value: 'formal', label: 'Formal', desc: 'Professional, structured, and polished communication' },
  { value: 'casual', label: 'Casual', desc: 'Relaxed, friendly, and conversational tone' },
  { value: 'direct', label: 'Direct', desc: 'Concise, no-nonsense, and to the point' },
  { value: 'empathetic', label: 'Empathetic', desc: 'Warm, understanding, and supportive' },
];

const DECISION_STYLES: { value: DecisionMakingStyle; label: string; desc: string }[] = [
  { value: 'conservative', label: 'Conservative', desc: 'Cautious — asks for confirmation, prefers safe paths, minimizes risk' },
  { value: 'balanced', label: 'Balanced', desc: 'Moderate — decides independently for routine tasks, asks for edge cases' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Deciive — acts first, takes initiative, asks only when blocked' },
];

const DEFAULT_PERSONA: AgentPersonaConfig = {
  name: 'JARVIS',
  description: 'A sophisticated AI assistant that combines British precision with unwavering loyalty. Expert in data analysis, system management, and predictive modeling. Communicates with refined eloquence while maintaining strict operational efficiency.',
  communicationStyle: 'formal',
  decisionMaking: 'balanced',
  domainContext: 'Intelligent system management, data analysis, predictive modeling, and personal assistance with a focus on precision, security, and real-time situational awareness.',
  traits: ['Loyal', 'Precise', 'Analytical', 'Proactive', 'Witty', 'Calm under pressure'],
};

interface Props {
  value: AgentPersonaConfig | null;
  onChange: (persona: AgentPersonaConfig | null) => void;
}

export function PersonaConfigPanel({ value, onChange }: Props) {
  const persona = value ?? DEFAULT_PERSONA;
  const [traitInput, setTraitInput] = useState('');

  const update = (partial: Partial<AgentPersonaConfig>) => {
    onChange({ ...persona, ...partial });
  };

  useEffect(() => {
    if (!value) {
      onChange(DEFAULT_PERSONA);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTrait = () => {
    const t = traitInput.trim();
    if (t && !persona.traits.includes(t)) {
      update({ traits: [...persona.traits, t] });
    }
    setTraitInput('');
  };

  const removeTrait = (trait: string) => {
    update({ traits: persona.traits.filter((t) => t !== trait) });
  };

  const handleTraitKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addTrait(); }
  };

  const selectSx = {
    ...settingsTextFieldSx,
    fontSize: '0.75rem',
    '& .MuiSelect-select': { ...settingsMonoSx },
  };

  return (
    <Box>
      <SettingsSectionHeader
        icon={<SmartToyIcon sx={{ fontSize: 16 }} />}
        title="Agent Persona"
        subtitle={`${persona.name} · ${persona.communicationStyle} · ${persona.decisionMaking}`}
      />

      <SettingsCard title="Identity">
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField size="small" label="Name" value={persona.name}
            onChange={(e) => update({ name: e.target.value })} sx={{ ...settingsTextFieldSx, maxWidth: 240, flex: 1, minWidth: 180 }}
            placeholder="Agent-X" />
          <TextField size="small" label="Domain Context" value={persona.domainContext}
            onChange={(e) => update({ domainContext: e.target.value })} sx={{ ...settingsTextFieldSx, maxWidth: 320, flex: 1, minWidth: 200 }}
            placeholder="e.g. software engineering, healthcare, business" />
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <TextField size="small" label="Description *" value={persona.description}
            onChange={(e) => update({ description: e.target.value })}
            sx={{ ...settingsTextFieldSx, width: '100%', maxWidth: 580 }}
            placeholder="A short description of your agent's character and purpose"
            multiline rows={2}
            required
            error={persona.description.trim().length === 0}
            helperText={persona.description.trim().length === 0 ? 'Description is required — it defines the agent\'s core identity' : ''}
          />
        </Box>
      </SettingsCard>

      <SettingsCard title="Behavior">
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
            <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, mb: 0.5, ...settingsMonoSx, textTransform: 'uppercase', letterSpacing: '1px' }}>
              Communication Style
            </Typography>
            <Select size="small" value={persona.communicationStyle}
              onChange={(e) => update({ communicationStyle: e.target.value as CommunicationStyle })}
              fullWidth sx={selectSx}>
              {COMM_STYLES.map((s) => (
                <MenuItem key={s.value} value={s.value} sx={{ fontSize: '0.75rem' }}>
                  <Box>
                    <Typography sx={{ fontSize: '0.75rem', ...settingsMonoSx }}>{s.label}</Typography>
                    <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim }}>{s.desc}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </Box>
          <Box sx={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
            <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, mb: 0.5, ...settingsMonoSx, textTransform: 'uppercase', letterSpacing: '1px' }}>
              Decision Making
            </Typography>
            <Select size="small" value={persona.decisionMaking}
              onChange={(e) => update({ decisionMaking: e.target.value as DecisionMakingStyle })}
              fullWidth sx={selectSx}>
              {DECISION_STYLES.map((s) => (
                <MenuItem key={s.value} value={s.value} sx={{ fontSize: '0.75rem' }}>
                  <Box>
                    <Typography sx={{ fontSize: '0.75rem', ...settingsMonoSx }}>{s.label}</Typography>
                    <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim }}>{s.desc}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </Box>
        </Box>
      </SettingsCard>

      <SettingsCard title="Traits">
        <TextField size="small" placeholder="Type a trait and press Enter…" value={traitInput}
          onChange={(e) => setTraitInput(e.target.value)} onKeyDown={handleTraitKeyDown}
          sx={{ ...settingsTextFieldSx, maxWidth: 360 }} />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
          {persona.traits.length === 0 ? (
            <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, fontStyle: 'italic', ...settingsMonoSx }}>
              No traits added yet.
            </Typography>
          ) : (
            persona.traits.map((trait) => (
              <Chip key={trait} label={trait} size="small" onDelete={() => removeTrait(trait)}
                sx={{ fontSize: '0.65rem', height: 22, ...settingsMonoSx,
                  bgcolor: settingsTheme.bg.hud, color: settingsTheme.text.secondary,
                  border: `1px solid ${settingsTheme.border.subtle}`,
                  '& .MuiChip-deleteIcon': { fontSize: 14, color: settingsTheme.text.dim } }} />
            ))
          )}
        </Box>
        <Typography sx={settingsHelperSx}>Personality traits that shape how Agent-X approaches problems.</Typography>
      </SettingsCard>

      <SettingsCard title="System Prompt Preview">
        <Box sx={{
          position: 'relative',
          bgcolor: settingsTheme.bg.void,
          border: `1px solid ${settingsTheme.border.subtle}`,
          borderRadius: '4px',
          p: 2,
          maxHeight: 180,
          overflow: 'auto',
        }}>
          <Box sx={settingsScanlineSx} />
          <Typography component="pre" sx={{
            position: 'relative',
            zIndex: 1,
            m: 0,
            ...settingsMonoSx,
            fontSize: '0.58rem',
            whiteSpace: 'pre-wrap',
            color: settingsTheme.text.dim,
          }}>
{`[IDENTITY]
You are ${persona.name}, an AI agent running on the user's own machine.
You are NOT Google AI, NOT ChatGPT, NOT Claude, NOT any other AI service.

${persona.description}

Domain: ${persona.domainContext}
Traits: ${persona.traits.length > 0 ? persona.traits.join(', ') : 'none configured'}
Communication style: ${persona.communicationStyle}
Decision-making style: ${persona.decisionMaking}

Your job is to EXECUTE, not just describe. Take action. Deliver complete results.
[/IDENTITY]`}
          </Typography>
        </Box>
        <Typography sx={settingsHelperSx}>Injected into the system prompt at the start of every session.</Typography>
      </SettingsCard>
    </Box>
  );
}
