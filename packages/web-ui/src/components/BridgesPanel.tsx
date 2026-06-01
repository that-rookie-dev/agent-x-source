import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Alert from '@mui/material/Alert';
import { bridges, type BridgeStatus } from '../api';
import { colors } from '../theme';

interface BridgeState {
  telegram: BridgeStatus | null;
  discord: BridgeStatus | null;
  slack: BridgeStatus | null;
  email: BridgeStatus | null;
}

export function BridgesPanel() {
  const [state, setState] = useState<BridgeState>({ telegram: null, discord: null, slack: null, email: null });
  const [error, setError] = useState('');

  // Telegram
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  // Discord
  const [dcToken, setDcToken] = useState('');
  const [dcChannel, setDcChannel] = useState('');
  // Slack
  const [slBotToken, setSlBotToken] = useState('');
  const [slAppToken, setSlAppToken] = useState('');

  useEffect(() => {
    const load = async () => {
      const [tg, dc, sl, em] = await Promise.allSettled([
        bridges.telegram.status(),
        bridges.discord.status(),
        bridges.slack.status(),
        bridges.email.status(),
      ]);
      setState({
        telegram: tg.status === 'fulfilled' ? tg.value : null,
        discord: dc.status === 'fulfilled' ? dc.value : null,
        slack: sl.status === 'fulfilled' ? sl.value : null,
        email: em.status === 'fulfilled' ? em.value : null,
      });
    };
    load();
  }, []);

  const statusChip = (s: BridgeStatus | null) => {
    if (!s) return <Chip size="small" label="Unknown" sx={{ fontSize: '0.6rem' }} />;
    return <Chip size="small" label={s.connected ? 'Connected' : s.configured ? 'Configured' : 'Not configured'} sx={{
      fontSize: '0.6rem',
      color: s.connected ? colors.accent.green : s.configured ? colors.accent.orange : colors.text.dim,
    }} />;
  };

  const handleTelegram = async (action: 'start' | 'stop') => {
    setError('');
    try {
      if (action === 'start') await bridges.telegram.start(tgToken, tgChatId || undefined);
      else await bridges.telegram.stop();
      const s = await bridges.telegram.status();
      setState((prev) => ({ ...prev, telegram: s }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleDiscord = async (action: 'start' | 'stop') => {
    setError('');
    try {
      if (action === 'start') await bridges.discord.start(dcToken, dcChannel || undefined);
      else await bridges.discord.stop();
      const s = await bridges.discord.status();
      setState((prev) => ({ ...prev, discord: s }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleSlack = async (action: 'start' | 'stop') => {
    setError('');
    try {
      if (action === 'start') await bridges.slack.start(slBotToken, slAppToken);
      else await bridges.slack.stop();
      const s = await bridges.slack.status();
      setState((prev) => ({ ...prev, slack: s }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Communication Bridges</Typography>
      {error && <Alert severity="error" sx={{ mb: 2, bgcolor: '#1a0000' }}>{error}</Alert>}

      {/* Telegram */}
      <Accordion sx={{ bgcolor: 'transparent', border: `1px solid ${colors.border.default}`, mb: 1, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: colors.text.dim }} />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>Telegram</Typography>
            {statusChip(state.telegram)}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField size="small" label="Bot Token" value={tgToken} onChange={(e) => setTgToken(e.target.value)} type="password" />
            <TextField size="small" label="Chat ID (optional)" value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="contained" onClick={() => handleTelegram('start')} sx={{ bgcolor: colors.accent.green, fontSize: '0.7rem' }}>Start</Button>
              <Button size="small" variant="outlined" onClick={() => handleTelegram('stop')} sx={{ fontSize: '0.7rem' }}>Stop</Button>
            </Box>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Discord */}
      <Accordion sx={{ bgcolor: 'transparent', border: `1px solid ${colors.border.default}`, mb: 1, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: colors.text.dim }} />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>Discord</Typography>
            {statusChip(state.discord)}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField size="small" label="Bot Token" value={dcToken} onChange={(e) => setDcToken(e.target.value)} type="password" />
            <TextField size="small" label="Channel ID (optional)" value={dcChannel} onChange={(e) => setDcChannel(e.target.value)} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="contained" onClick={() => handleDiscord('start')} sx={{ bgcolor: colors.accent.green, fontSize: '0.7rem' }}>Start</Button>
              <Button size="small" variant="outlined" onClick={() => handleDiscord('stop')} sx={{ fontSize: '0.7rem' }}>Stop</Button>
            </Box>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Slack */}
      <Accordion sx={{ bgcolor: 'transparent', border: `1px solid ${colors.border.default}`, mb: 1, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: colors.text.dim }} />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>Slack</Typography>
            {statusChip(state.slack)}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField size="small" label="Bot Token" value={slBotToken} onChange={(e) => setSlBotToken(e.target.value)} type="password" />
            <TextField size="small" label="App Token" value={slAppToken} onChange={(e) => setSlAppToken(e.target.value)} type="password" />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="contained" onClick={() => handleSlack('start')} sx={{ bgcolor: colors.accent.green, fontSize: '0.7rem' }}>Start</Button>
              <Button size="small" variant="outlined" onClick={() => handleSlack('stop')} sx={{ fontSize: '0.7rem' }}>Stop</Button>
            </Box>
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Email */}
      <Accordion sx={{ bgcolor: 'transparent', border: `1px solid ${colors.border.default}`, mb: 1, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: colors.text.dim }} />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>Email</Typography>
            {statusChip(state.email)}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="caption" sx={{ color: colors.text.dim }}>Email bridge configuration coming soon</Typography>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
