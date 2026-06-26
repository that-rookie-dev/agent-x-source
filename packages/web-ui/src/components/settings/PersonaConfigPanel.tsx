import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import type { AgentPersonaConfig, CommunicationStyle, DecisionMakingStyle } from '../../api';
import { crewTheme, crewOverlineSx } from '../../styles/crew-theme';

const cardSx = {
  position: 'relative' as const,
  bgcolor: crewTheme.bg.inset,
  border: `1px solid ${crewTheme.border.default}`,
  borderRadius: '8px',
  p: 3,
  mb: 2,
  overflow: 'hidden',
};

const labelSx = {
  ...crewOverlineSx,
  fontSize: '0.65rem',
  mb: 0.75,
  display: 'block',
};

const helperSx = {
  fontSize: '0.65rem',
  color: crewTheme.text.dim,
  mt: 0.5,
  lineHeight: 1.5,
};

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

  // Sync local DEFAULT_PERSONA into parent on first render if value is null
  useEffect(() => {
    if (!value) {
      onChange(DEFAULT_PERSONA);
    }
    // Run once on mount
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

  return (
    <Box>
      {/* Name & Description */}
      <Box sx={cardSx}>
        <Typography sx={labelSx}>Identity</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField size="small" label="Name" value={persona.name}
            onChange={(e) => update({ name: e.target.value })} sx={{ maxWidth: 240, flex: 1, minWidth: 180 }}
            placeholder="Agent-X"
            slotProps={{ input: { sx: { fontSize: '0.8rem' } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />
          <TextField size="small" label="Domain Context" value={persona.domainContext}
            onChange={(e) => update({ domainContext: e.target.value })} sx={{ maxWidth: 320, flex: 1, minWidth: 200 }}
            placeholder="e.g. software engineering, healthcare, business"
            slotProps={{ input: { sx: { fontSize: '0.8rem' } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <TextField size="small" label="Description *" value={persona.description}
            onChange={(e) => update({ description: e.target.value })}
            sx={{ width: '100%', maxWidth: 580 }}
            placeholder="A short description of your agent's character and purpose — this defines the agent's identity"
            multiline rows={2}
            required
            error={persona.description.trim().length === 0}
            helperText={persona.description.trim().length === 0 ? 'Description is required — it defines the agent\'s core identity' : ''}
            slotProps={{ input: { sx: { fontSize: '0.8rem', lineHeight: 1.5 } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />
        </Box>
      </Box>

      {/* Communication & Decision Making */}
      <Box sx={cardSx}>
        <Typography sx={labelSx}>Behavior</Typography>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
            <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.dim, mb: 0.5, fontFamily: "'JetBrains Mono', monospace" }}>
              Communication Style
            </Typography>
            <Select size="small" value={persona.communicationStyle}
              onChange={(e) => update({ communicationStyle: e.target.value as CommunicationStyle })}
              fullWidth
              sx={{ fontSize: '0.8rem', fontFamily: "'JetBrains Mono', monospace" }}>
              {COMM_STYLES.map((s) => (
                <MenuItem key={s.value} value={s.value} sx={{ fontSize: '0.8rem' }}>
                  <Box>
                    <Typography sx={{ fontSize: '0.8rem', fontFamily: "'JetBrains Mono', monospace" }}>{s.label}</Typography>
                    <Typography sx={{ fontSize: '0.6rem', color: crewTheme.text.dim }}>{s.desc}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </Box>
          <Box sx={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
            <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.dim, mb: 0.5, fontFamily: "'JetBrains Mono', monospace" }}>
              Decision Making
            </Typography>
            <Select size="small" value={persona.decisionMaking}
              onChange={(e) => update({ decisionMaking: e.target.value as DecisionMakingStyle })}
              fullWidth
              sx={{ fontSize: '0.8rem', fontFamily: "'JetBrains Mono', monospace" }}>
              {DECISION_STYLES.map((s) => (
                <MenuItem key={s.value} value={s.value} sx={{ fontSize: '0.8rem' }}>
                  <Box>
                    <Typography sx={{ fontSize: '0.8rem', fontFamily: "'JetBrains Mono', monospace" }}>{s.label}</Typography>
                    <Typography sx={{ fontSize: '0.6rem', color: crewTheme.text.dim }}>{s.desc}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </Box>
        </Box>
      </Box>

      {/* Traits */}
      <Box sx={cardSx}>
        <Typography sx={labelSx}>Traits</Typography>
        <TextField size="small" placeholder="Type a trait and press Enter..." value={traitInput}
          onChange={(e) => setTraitInput(e.target.value)} onKeyDown={handleTraitKeyDown}
          sx={{ maxWidth: 360 }}
          slotProps={{ input: { sx: { fontSize: '0.8rem' } } }} />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
          {persona.traits.length === 0 ? (
            <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.dim, fontStyle: 'italic' }}>
              No traits added. Add traits like "analytical", "creative", "practical", "curious".
            </Typography>
          ) : (
            persona.traits.map((trait) => (
              <Chip key={trait} label={trait} size="small" onDelete={() => removeTrait(trait)}
                sx={{ fontSize: '0.7rem', height: 22, fontFamily: "'JetBrains Mono', monospace",
                  bgcolor: crewTheme.border.subtle, color: crewTheme.text.secondary,
                  '& .MuiChip-deleteIcon': { fontSize: 14, color: crewTheme.text.dim } }} />
            ))
          )}
        </Box>
        <Typography sx={helperSx}>Personality traits that define how Agent-X approaches problems and interacts.</Typography>
      </Box>

      {/* Preview */}
      <Box sx={cardSx}>
        <Typography sx={labelSx}>System Prompt Preview</Typography>
        <Box sx={{
          bgcolor: crewTheme.bg.void, border: `1px solid ${crewTheme.border.subtle}`,
          borderRadius: 1, p: 2, maxHeight: 180, overflow: 'auto',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', whiteSpace: 'pre-wrap', color: crewTheme.text.dim,
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
        </Box>
        <Typography sx={helperSx}>This [IDENTITY] block is injected into the system prompt at the start of every session.</Typography>
      </Box>
    </Box>
  );
}
