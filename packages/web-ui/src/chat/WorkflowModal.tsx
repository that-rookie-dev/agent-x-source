import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { orderPartsForChatRender } from '@agentx/shared/browser';
import { colors, alphaColor } from '../theme';
import { ReasoningBlock } from '../components/ChatEnhancements';
import { InlineToolCall } from '../components/InlineToolCall';
import { DeepSearchMessageBlock } from './DeepSearchMessageBlock';
import type { UIMessage, PartEntry } from './types';

interface Props {
  message: UIMessage;
  onClose: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: '0.58rem',
      fontWeight: 700,
      color: colors.text.dim,
      fontFamily: "'JetBrains Mono', monospace",
      textTransform: 'uppercase',
      letterSpacing: '1.5px',
      mt: 1.5,
      mb: 0.75,
    }}>
      {children}
    </Typography>
  );
}

/**
 * On-demand detail view of a turn's workflow: reasoning, tool calls, and deep
 * search steps. Mounted only while open — closing destroys the DOM so the
 * chat thread never carries this weight.
 */
export function WorkflowModal({ message, onClose }: Props) {
  const parts = (message.parts ?? []) as PartEntry[];
  const ordered = orderPartsForChatRender(parts);

  const toolParts = ordered.filter((p) => p.type === 'tool' && p.tool);
  const deepSearchParts = ordered.filter(
    (p) => p.type === 'deep_search' && (p.deepSearch?.bundle || p.deepSearch?.progress),
  );
  // Fallback for messages whose parts were not rebuilt but toolCalls persist.
  const fallbackTools = toolParts.length === 0 ? (message.toolCalls ?? []) : [];

  const stepCount = toolParts.length + fallbackTools.length + deepSearchParts.length;

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: colors.bg.primary,
          border: `1px solid ${colors.border.default}`,
          borderRadius: 1.5,
          maxHeight: '82vh',
        },
      }}
    >
      <DialogTitle sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        borderBottom: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.secondary,
      }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
            Turn workflow
          </Typography>
          <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.25 }}>
            {stepCount} step{stepCount === 1 ? '' : 's'}
            {message.thinking ? ' · reasoning' : ''}
            {message.timestamp ? ` · ${new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, '&:hover': { color: colors.text.primary } }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 2, py: 1 }}>
        {message.thinking && (
          <>
            <SectionLabel>Reasoning</SectionLabel>
            <ReasoningBlock
              text={message.thinking}
              streaming={false}
              durationMs={message.thinkingDoneAt && message.thinkingStartedAt
                ? (message.thinkingDoneAt - message.thinkingStartedAt)
                : undefined}
            />
          </>
        )}

        {(toolParts.length > 0 || fallbackTools.length > 0) && (
          <>
            <SectionLabel>Tool calls</SectionLabel>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {toolParts.map((p) => (
                <InlineToolCall key={p.id} tool={p.tool!} />
              ))}
              {fallbackTools.map((t) => (
                <InlineToolCall key={t.id} tool={{ ...t, status: t.status || 'done' }} />
              ))}
            </Box>
          </>
        )}

        {deepSearchParts.length > 0 && (
          <>
            <SectionLabel>Deep search</SectionLabel>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {deepSearchParts.map((p) => (
                <DeepSearchMessageBlock
                  key={p.id}
                  bundle={p.deepSearch!.bundle}
                  progress={p.deepSearch!.progress}
                  running={false}
                />
              ))}
            </Box>
          </>
        )}

        {stepCount === 0 && !message.thinking && (
          <Typography sx={{
            fontSize: '0.68rem',
            color: colors.text.dim,
            py: 3,
            textAlign: 'center',
            fontFamily: "'JetBrains Mono', monospace",
            bgcolor: alphaColor(colors.bg.tertiary, '40'),
            borderRadius: 1,
            mt: 1.5,
          }}>
            No workflow steps recorded for this turn.
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
