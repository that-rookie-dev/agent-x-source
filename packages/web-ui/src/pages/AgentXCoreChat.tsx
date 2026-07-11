import { lazy, Suspense, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { getCoreSessionId } from '../perf/api-cache';

const ChatPanel = lazy(() => import('../components/ChatPanel').then((m) => ({ default: m.ChatPanel })));

function ChatPanelLazy(props: { sessionId: string; coreSession?: boolean }) {
  return (
    <Suspense fallback={(
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} sx={{ color: colors.text.dim }} />
      </Box>
    )}>
      <ChatPanel {...props} />
    </Suspense>
  );
}

export function AgentXCoreChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const id = await getCoreSessionId();
        setSessionId(id);
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

  return <ChatPanelLazy sessionId={sessionId} coreSession />;
}
