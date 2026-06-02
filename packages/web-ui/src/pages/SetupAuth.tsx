import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import LockIcon from '@mui/icons-material/Lock';
import { auth } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: colors.text.dim };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) score++;
  if (pw.length >= 16) score++;

  if (score <= 2) return { score: Math.round((score / 7) * 100), label: 'WEAK', color: colors.accent.red };
  if (score <= 4) return { score: Math.round((score / 7) * 100), label: 'FAIR', color: colors.accent.orange };
  if (score <= 5) return { score: Math.round((score / 7) * 100), label: 'GOOD', color: colors.accent.blue };
  return { score: Math.round((score / 7) * 100), label: 'STRONG', color: colors.accent.green };
}

export function SetupAuth() {
  const { setAuthenticated } = useApp();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (username.length < 3) { setError('Username must be at least 3 characters'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setError('Password must contain uppercase, lowercase, number, and special character');
      return;
    }

    setLoading(true);
    try {
      await auth.setup(username, password);
      setAuthenticated(true, username);
      navigate('/setup/wizard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Box sx={{ width: 400, maxWidth: '90vw' }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <LockIcon sx={{ fontSize: 40, color: colors.accent.blue, mb: 1 }} />
          <Typography variant="h2" sx={{ mb: 1 }}>CREATE ROOT USER</Typography>
          <Typography variant="body2" sx={{ color: colors.text.tertiary }}>
            Set up credentials for your Agent-X console
          </Typography>
        </Box>

        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {error && <Alert severity="error" sx={{ bgcolor: '#1a0000', border: `1px solid ${colors.accent.red}40` }}>{error}</Alert>}

          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            fullWidth
            inputProps={{ minLength: 3 }}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            helperText="Min 8 chars: uppercase, lowercase, number, special"
          />
          {password && (
            <Box sx={{ mt: -1 }}>
              <LinearProgress
                variant="determinate"
                value={strength.score}
                sx={{
                  height: 4,
                  borderRadius: 2,
                  bgcolor: colors.bg.tertiary,
                  '& .MuiLinearProgress-bar': {
                    bgcolor: strength.color,
                    borderRadius: 2,
                    transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s ease',
                  },
                }}
              />
              <Typography
                variant="caption"
                sx={{
                  mt: 0.5,
                  display: 'block',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.65rem',
                  letterSpacing: '2px',
                  color: strength.color,
                  transition: 'color 0.3s ease',
                }}
              >
                {strength.label}
              </Typography>
            </Box>
          )}
          <TextField
            label="Confirm Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            fullWidth
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ mt: 1, py: 1.2, bgcolor: colors.text.primary, color: colors.bg.primary, fontWeight: 600, '&:hover': { bgcolor: '#ccc' } }}
          >
            {loading ? 'Creating...' : 'Create Account & Continue'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
