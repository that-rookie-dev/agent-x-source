import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MicIcon from '@mui/icons-material/Mic';
import { voice, type VoiceConfig } from '../api';
import { colors } from '../theme';
import { voiceDisabledReason } from '../voice/support';

/** Compact voice entry for DockingStation / Console landing — reuses chat voice session. */
export function VoiceQuickEntry() {
  const navigate = useNavigate();
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig | null>(null);
  const [canRunWeb, setCanRunWeb] = useState(false);
  const envBlocked = voiceDisabledReason();

  useEffect(() => {
    void (async () => {
      try {
        const [cfg, caps] = await Promise.all([voice.getConfig(), voice.capabilities()]);
        setVoiceConfig(cfg);
        setCanRunWeb(Boolean(caps.capabilities.canRunWeb));
      } catch {
        setVoiceConfig(null);
      }
    })();
  }, []);

  const webMode = voiceConfig?.mode?.web ?? 'off';
  const voiceEnabled = Boolean(voiceConfig?.enabled) && webMode !== 'off';
  if (!voiceEnabled || envBlocked) return null;

  const openVoiceChat = (startVoice: boolean) => {
    navigate('/console/chat', { state: startVoice ? { startVoice: true } : undefined });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
      <Chip
        size="small"
        icon={<MicIcon sx={{ fontSize: 14 }} />}
        label={canRunWeb ? 'Local voice ready' : 'Voice setup needed'}
        sx={{ alignSelf: 'flex-start', fontSize: '0.55rem', height: 20 }}
      />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MicIcon sx={{ fontSize: '0.85rem !important' }} />}
          onClick={() => openVoiceChat(true)}
          disabled={!canRunWeb}
          sx={{
            flex: 1,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.6rem',
            borderColor: colors.border.strong,
            color: colors.text.secondary,
          }}
        >
          Talk now
        </Button>
        <Button
          size="small"
          onClick={() => openVoiceChat(false)}
          sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', color: colors.text.dim }}
        >
          Open chat
        </Button>
      </Box>
    </Box>
  );
}
