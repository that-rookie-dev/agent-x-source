import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { copyToClipboard } from '../utils/clipboard';
import { colors, alphaColor } from '../theme';

const BASE = '/api';

async function writeDebugLog(entry: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${BASE}/debug/log`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: new Date().toISOString(), source: 'web-ui', ...entry }),
    });
  } catch { /* best effort */ }
}

export { writeDebugLog };

interface ErrorBandContextValue {
  showError: (message: string) => void;
  clearError: () => void;
  logDebug: (entry: Record<string, unknown>) => Promise<void>;
}

const ErrorBandContext = createContext<ErrorBandContextValue | null>(null);

export function useGlobalError(): ErrorBandContextValue {
  const ctx = useContext(ErrorBandContext);
  if (!ctx) throw new Error('useGlobalError must be inside ErrorBandProvider');
  return ctx;
}

export function ErrorBandProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      setIsOverflowing(el.scrollWidth > el.clientWidth);
    }
  }, [error]);

  const showError = useCallback((message: string) => {
    setError(message);
    setExpanded(false);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setExpanded(false);
  }, []);

  const logDebug = useCallback(async (entry: Record<string, unknown>) => {
    await writeDebugLog(entry);
  }, []);

  return (
    <ErrorBandContext.Provider value={{ showError, clearError, logDebug }}>
      {children}
      {error && (
        <Box
          onClick={() => setExpanded((e) => !e)}
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            bgcolor: `color-mix(in srgb, ${colors.accent.red} 10%, ${colors.bg.primary})`,
            borderBottom: `1px solid ${alphaColor(colors.accent.red, 0.3)}`,
            cursor: isOverflowing ? 'pointer' : 'default',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              px: 2,
              py: 0.5,
              minHeight: 28,
            }}
          >
            <Box
              sx={{
                flex: 1,
                overflow: 'hidden',
              }}
            >
              <Typography
                ref={textRef}
                sx={{
                  color: colors.accent.red,
                  fontSize: '0.72rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  textAlign: 'left',
                  whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
                  overflow: expanded ? 'visible' : 'hidden',
                  textOverflow: expanded ? 'clip' : 'ellipsis',
                  lineHeight: expanded ? 1.5 : 1,
                  maxHeight: expanded ? 240 : 18,
                  transition: 'max-height 0.28s ease, line-height 0.28s ease',
                }}
              >
                {error}
              </Typography>
            </Box>
            {isOverflowing && (
              <Typography
                sx={{
                  color: alphaColor(colors.accent.red, 0.8),
                  fontSize: '0.6rem',
                  ml: 1,
                  flexShrink: 0,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1,
                  transition: 'transform 0.28s ease',
                  transform: expanded ? 'rotate(180deg)' : 'none',
                }}
              >
                ▼
              </Typography>
            )}
            <Tooltip title="Copy error + log location" arrow placement="top">
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  const logDir = '~/.local/share/agentx/debug-logs/';
                  const ts = new Date().toISOString();
                  const text = `[Agent-X Error @ ${ts}]\n${error}\n\nDebug logs: ${logDir}`;
                  void copyToClipboard(text);
                }}
                sx={{
                  minWidth: 20,
                  height: 20,
                  p: 0,
                  ml: 0.5,
                  color: alphaColor(colors.accent.red, 0.8),
                  fontSize: '0.65rem',
                  flexShrink: 0,
                  lineHeight: 1,
                  '&:hover': { color: colors.accent.red, bgcolor: 'transparent' },
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </Button>
            </Tooltip>
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                clearError();
              }}
              sx={{
                minWidth: 20,
                height: 20,
                p: 0,
                ml: 0.5,
                color: alphaColor(colors.accent.red, 0.8),
                fontSize: '0.65rem',
                flexShrink: 0,
                lineHeight: 1,
                '&:hover': { color: colors.accent.red, bgcolor: 'transparent' },
              }}
            >
              ✕
            </Button>
          </Box>
        </Box>
      )}
    </ErrorBandContext.Provider>
  );
}
