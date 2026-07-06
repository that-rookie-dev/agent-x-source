import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { ChatPanel } from '../components/ChatPanel';
import { colors } from '../theme';

export function AgentXCoreChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/agent-x-core/session', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error('Failed to open Agent-X session');
        const data = await res.json() as { sessionId?: string };
        if (!data.sessionId) throw new Error('Missing session id');
        setSessionId(data.sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Agent-X');
      }
    })();
  }, []);

  if (error) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography sx={{ color: colors.accent.red, fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace" }}>
          {error}
        </Typography>
      </Box>
    );
  }

  if (!sessionId) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} sx={{ color: colors.text.dim }} />
      </Box>
    );
  }

  return <ChatPanel sessionId={sessionId} coreSession />;
}
